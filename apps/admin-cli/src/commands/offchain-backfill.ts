import { PgBoss } from 'pg-boss';
import { ArchiveEventRepository, OffChainCursorRepository, pgDb, type SourceType } from '@libs/db';
import type { ArchiveEventType, JsonValue } from '@libs/domain';
import { applyOffChainMutableLatest } from '@sources/core';
import type {
  ArchiveConsumeContext,
  OffChainArchiveWriteFn,
  PollItem,
  PollListener,
  PollPollContext,
  QueueProducerPort,
  SourceContext,
} from '@sources/core';
import { buildOffChainBackfillSource } from '../plugins/offchain-backfill-source-plugins.js';

/** How the drained items are persisted: enqueue to the indexer consumer, or write in-process. */
export type OffChainSinkMode = 'enqueue' | 'direct';

/** A dao_source row shape sufficient to drive an off-chain backfill (no block columns). */
export interface OffChainBackfillTarget {
  id: string;
  source_type: string;
  source_config: unknown;
  chain_id: string;
}

// pg-boss queue name — kept in sync with apps/indexer/src/queue/queue-names.ts (OFF_CHAIN_ARCHIVE_QUEUE).
const OFF_CHAIN_ARCHIVE_QUEUE = 'off_chain_archive';

export interface OffChainDrainOptions {
  /** K — consecutive empty-and-non-advancing ticks that mark the drain caught-up (default 3). */
  quiescenceTicks: number;
  /** Pacing delay between ticks (rate-limit politeness); 0 disables. */
  interTickDelayMs: number;
}

export interface OffChainDrainOutcome {
  status: 'completed' | 'cancelled';
  ticks: number;
  itemsProcessed: number;
}

/**
 * Drives a from-genesis off-chain backfill to completion by repeatedly polling the listener and
 * committing each tick through the sink (enqueue or --direct), resuming from the persisted cursor.
 *
 * `PollResult` has no `done` flag (the transport was built for perpetual live polling), so completion
 * is inferred: the drain stops after `quiescenceTicks` consecutive ticks that leave the cursor
 * unadvanced (no forward progress) — whether the tick was empty or re-read the same tip page. A
 * conservative default (K=3) avoids stopping at a transient sparse window. SIGINT/SIGTERM aborts via
 * the signal (ADR-047); the persisted cursor makes a partial run resumable.
 */
export async function runOffChainDrain(input: {
  source: SourceContext;
  listener: PollListener<JsonValue>;
  producer: QueueProducerPort;
  options: OffChainDrainOptions;
  signal: AbortSignal;
  onTick?: (info: { tick: number; items: number; quiescent: number }) => void;
}): Promise<OffChainDrainOutcome> {
  const { source, listener, producer, options, signal } = input;
  let cursor = await producer.loadCursor(source);
  let quiescent = 0;
  let ticks = 0;
  let itemsProcessed = 0;

  while (!signal.aborted && quiescent < options.quiescenceTicks) {
    const ctx: PollPollContext = { source, signal };
    const result = await listener.poll(ctx, cursor);
    await producer.commitTick(source, result.items, result.nextCursor);

    ticks += 1;
    itemsProcessed += result.items.length;
    const advanced = !cursorsEqual(cursor, result.nextCursor);
    cursor = result.nextCursor;
    // Quiescent = no forward progress (the cursor did not advance). This covers both "caught up, the
    // tick is empty" and the boundary re-read, where the tip page keeps returning the same items at
    // an unchanged cursor — the sink dedups them, but items>0 must not reset quiescence forever.
    if (!advanced) quiescent += 1;
    else quiescent = 0;

    input.onTick?.({ tick: ticks, items: result.items.length, quiescent });

    if (quiescent < options.quiescenceTicks && options.interTickDelayMs > 0) {
      await sleepAbortable(options.interTickDelayMs, signal);
    }
  }

  return { status: signal.aborted ? 'cancelled' : 'completed', ticks, itemsProcessed };
}

/** Structural equality over two partition-aware cursors (JsonValue). */
export function cursorsEqual(a: JsonValue | null, b: JsonValue | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface OffChainArchiveJobShape {
  daoSourceId: string;
  sourceType: string;
  externalId: string;
  eventType: ArchiveEventType;
  contentHash: string;
  ordinal: string | null;
  payload: unknown;
}

function buildJob(source: SourceContext, item: PollItem): OffChainArchiveJobShape {
  return {
    daoSourceId: source.daoSourceId,
    sourceType: source.sourceType,
    externalId: item.externalId,
    eventType: item.eventType,
    contentHash: item.contentHash,
    ordinal: item.ordinal,
    payload: item.payload,
  };
}

function toArchiveContext(source: SourceContext): ArchiveConsumeContext {
  return {
    daoSourceId: source.daoSourceId,
    sourceType: source.sourceType,
    chainId: source.chainId,
    sourceLabel: source.sourceLabel,
  };
}

/**
 * Enqueue sink (default): sends each item to the `off_chain_archive` pg-boss queue, then advances the
 * persisted cursor. Not cross-store atomic (pg-boss vs the cursor txn) — safe because the off-chain
 * consumer is idempotent on `(external_id, content_hash)`: a crash between send and cursor-advance
 * re-enqueues and the consumer dedups. Requires the indexer off-chain consumer to be running to drain
 * the queue.
 */
export class EnqueueOffChainProducer implements QueueProducerPort {
  constructor(
    private readonly boss: PgBoss,
    private readonly cursorRepo: OffChainCursorRepository,
  ) {}

  async loadCursor(source: SourceContext): Promise<JsonValue | null> {
    return this.cursorRepo.load(source.daoSourceId);
  }

  async commitTick(
    source: SourceContext,
    items: readonly PollItem[],
    nextCursor: JsonValue | null,
  ): Promise<void> {
    try {
      for (const item of items) {
        await this.boss.send(OFF_CHAIN_ARCHIVE_QUEUE, buildJob(source, item));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The enqueue sink needs the indexer's off-chain consumer running to create + drain the queue.
      // A standalone backfill has no consumer, so point the operator at --direct instead of leaving
      // them with a bare "queue does not exist".
      if (/queue .*does not exist|does not exist/i.test(message)) {
        throw new Error(
          `Off-chain enqueue failed: the '${OFF_CHAIN_ARCHIVE_QUEUE}' pg-boss queue does not exist. ` +
            `The enqueue sink requires the indexer off-chain consumer to be running. For a standalone ` +
            `backfill, re-run with --direct to write the archive in-process.`,
          { cause: error },
        );
      }
      throw error;
    }
    await pgDb
      .transaction()
      .execute((trx) => this.cursorRepo.upsert(trx, source.daoSourceId, nextCursor));
  }
}

/**
 * Runs a from-genesis off-chain backfill for one dao_source row: resolves its poll listener + CH writer
 * (forward-only), builds the requested sink, and drains to quiescence. Owns the pg-boss lifecycle for
 * the enqueue sink. Cancellation + resumability come from the shared drain loop.
 */
export async function runOffChainBackfillForSource(input: {
  target: OffChainBackfillTarget;
  mode: OffChainSinkMode;
  options: OffChainDrainOptions;
  signal: AbortSignal;
  onTick?: (info: { tick: number; items: number; quiescent: number }) => void;
}): Promise<OffChainDrainOutcome> {
  const source: SourceContext = {
    daoSourceId: input.target.id,
    sourceType: input.target.source_type as SourceType,
    chainId: input.target.chain_id,
    sourceLabel: input.target.source_type as SourceType,
  };
  const { listener, write } = buildOffChainBackfillSource({
    sourceType: input.target.source_type,
    sourceConfig: input.target.source_config,
    ctx: source,
  });
  const cursorRepo = new OffChainCursorRepository(pgDb);

  let producer: QueueProducerPort;
  let boss: PgBoss | undefined;
  if (input.mode === 'direct') {
    producer = new DirectOffChainProducer(new ArchiveEventRepository(pgDb), write, cursorRepo);
  } else {
    boss = new PgBoss({
      connectionString: process.env['DATABASE_URL'],
      schema: 'pgboss',
      migrate: false,
    });
    await boss.start();
    producer = new EnqueueOffChainProducer(boss, cursorRepo);
  }

  try {
    return await runOffChainDrain({
      source,
      listener,
      producer,
      options: input.options,
      signal: input.signal,
      onTick: input.onTick,
    });
  } finally {
    await boss?.stop();
  }
}

/**
 * Direct sink (`--direct`): writes the archive in-process via the shared mutable-latest core (ADR-071),
 * then advances the cursor — a self-contained CLI run needing no indexer. Idempotent (skips on
 * unchanged content), so a re-fetch after a crash is a no-op except for genuine edits. Shares the exact
 * `applyOffChainMutableLatest` routine the live consumer uses, so the two paths cannot drift.
 */
export class DirectOffChainProducer implements QueueProducerPort {
  constructor(
    private readonly archiveEventRepo: ArchiveEventRepository,
    private readonly write: OffChainArchiveWriteFn,
    private readonly cursorRepo: OffChainCursorRepository,
  ) {}

  async loadCursor(source: SourceContext): Promise<JsonValue | null> {
    return this.cursorRepo.load(source.daoSourceId);
  }

  async commitTick(
    source: SourceContext,
    items: readonly PollItem[],
    nextCursor: JsonValue | null,
  ): Promise<void> {
    const ctx = toArchiveContext(source);
    for (const item of items) {
      await applyOffChainMutableLatest(
        ctx,
        {
          externalId: item.externalId,
          contentHash: item.contentHash,
          ordinal: item.ordinal,
          eventType: item.eventType,
          payload: item.payload,
        },
        { archiveEventRepo: this.archiveEventRepo, write: this.write },
      );
    }
    await pgDb
      .transaction()
      .execute((trx) => this.cursorRepo.upsert(trx, source.daoSourceId, nextCursor));
  }
}
