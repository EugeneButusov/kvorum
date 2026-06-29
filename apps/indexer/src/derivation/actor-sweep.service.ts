import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  DlqRepository,
  type ArchiveDerivationRow,
  type OffchainArchiveRow,
} from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorSweepAdapter, OffchainActorAddressDeriver } from '@sources/core';
import { readIntervalMs } from '../app/env-helpers';

const ACTOR_SWEEP_INTERVAL_MS = readIntervalMs('ACTOR_SWEEP_INTERVAL_MS', 5_000);
const DEFAULT_ACTOR_SWEEP_BATCH_SIZE = 50;
const ACTOR_SWEEP_DLQ_THRESHOLD = Number(process.env['ACTOR_SWEEP_DLQ_THRESHOLD'] ?? '5');
const ACTOR_RESOLUTION_STAGE = 'actor_resolution_stage';
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
type ActorAddressSource = Parameters<ActorRepository['findOrCreateActorAddress']>[1];

@Injectable()
export class ActorSweepService {
  private readonly logger = new Logger('ActorSweep');
  private inFlight = false;
  private readonly eventTypes: readonly ArchiveEventType[];
  private readonly adapterBySourceType: ReadonlyMap<string, ActorSweepAdapter>;
  private readonly offchainEventTypes: readonly ArchiveEventType[];
  private readonly offchainAdapterBySourceType: ReadonlyMap<string, OffchainActorAddressDeriver>;

  constructor(
    private readonly actorResolution: ArchiveActorResolutionRepository,
    private readonly actors: ActorRepository,
    private readonly dlq: DlqRepository,
    adapters: readonly ActorSweepAdapter[],
    offchainAdapters: readonly OffchainActorAddressDeriver[] = [],
  ) {
    this.eventTypes = [...new Set(adapters.flatMap((adapter) => adapter.eventTypes))];
    this.adapterBySourceType = new Map(
      adapters.flatMap((adapter) =>
        adapter.sourceTypes.map((sourceType) => [sourceType, adapter] as const),
      ),
    );
    this.offchainEventTypes = [...new Set(offchainAdapters.flatMap((a) => a.eventTypes))];
    this.offchainAdapterBySourceType = new Map(
      offchainAdapters.flatMap((adapter) =>
        adapter.sourceTypes.map((sourceType) => [sourceType, adapter] as const),
      ),
    );
  }

  @Interval(ACTOR_SWEEP_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const batchSize = Number(
        process.env['ACTOR_SWEEP_BATCH_SIZE'] ?? DEFAULT_ACTOR_SWEEP_BATCH_SIZE,
      );
      const rows = await this.actorResolution.findUnresolvedActors(
        this.eventTypes,
        ACTOR_SWEEP_DLQ_THRESHOLD,
        batchSize,
      );
      const bySourceType = groupBySourceType(rows);
      for (const [sourceType, batch] of bySourceType) {
        await this.processSourceBatch(sourceType, batch);
      }

      const offchainRows = await this.actorResolution.findUnresolvedActorsOffchain(
        this.offchainEventTypes,
        ACTOR_SWEEP_DLQ_THRESHOLD,
        batchSize,
      );
      const byOffchainSourceType = groupBySourceType(offchainRows);
      for (const [sourceType, batch] of byOffchainSourceType) {
        await this.processOffchainSourceBatch(sourceType, batch);
      }
    } catch (err) {
      this.logger.error('actor_sweep_tick_failed', { error: String(err) });
    } finally {
      this.inFlight = false;
    }
  }

  private async processSourceBatch(
    sourceType: string,
    rows: readonly ArchiveDerivationRow[],
  ): Promise<void> {
    try {
      const adapter = this.adapterBySourceType.get(sourceType);
      if (adapter === undefined) {
        throw new Error(`no actor sweep adapter for source_type ${sourceType}`);
      }
      const payloads = await adapter.fetchPayloads(rows);
      const byKey = new Map(payloads.map((payload) => [archiveRowKey(payload), payload]));

      for (const row of rows) {
        const payload = byKey.get(archiveRowKey(row));
        if (payload === undefined) {
          await this.handleFailure(row, new Error('archive payload missing'));
          continue;
        }

        try {
          const candidates = adapter.extractAddresses(row.event_type, payload.payload);
          for (const candidate of candidates) {
            const normalized = candidate.address.toLowerCase();
            if (normalized === ZERO_ADDRESS) continue;
            await this.actors.findOrCreateActorAddress(
              normalized,
              candidate.source as ActorAddressSource,
            );
          }
          await this.actorResolution.markActorResolved(row.id);
        } catch (err) {
          await this.handleFailure(row, err);
        }
      }
    } catch (err) {
      for (const row of rows) {
        await this.handleFailure(row, err);
      }
    }
  }

  private async processOffchainSourceBatch(
    sourceType: string,
    rows: readonly OffchainArchiveRow[],
  ): Promise<void> {
    try {
      const adapter = this.offchainAdapterBySourceType.get(sourceType);
      if (adapter === undefined) {
        throw new Error(`no off-chain actor sweep adapter for source_type ${sourceType}`);
      }
      const payloads = await adapter.fetchPayloads(rows);
      const byKey = new Map(payloads.map((payload) => [payload.external_id, payload]));

      for (const row of rows) {
        const payload = byKey.get(row.external_id);
        if (payload === undefined) {
          await this.handleFailureOffchain(row, new Error('archive payload missing'));
          continue;
        }

        try {
          const candidates = adapter.extractAddresses(row.event_type, payload.payload);
          for (const candidate of candidates) {
            const normalized = candidate.address.toLowerCase();
            if (normalized === ZERO_ADDRESS) continue;
            await this.actors.findOrCreateActorAddress(
              normalized,
              (candidate.role ?? 'unknown_event') as ActorAddressSource,
            );
          }
          await this.actorResolution.markActorResolved(row.id);
        } catch (err) {
          await this.handleFailureOffchain(row, err);
        }
      }
    } catch (err) {
      for (const row of rows) {
        await this.handleFailureOffchain(row, err);
      }
    }
  }

  private async handleFailureOffchain(row: OffchainArchiveRow, err: unknown): Promise<void> {
    const attempt = await this.actorResolution.incrementActorResolutionAttemptCount(row.id);
    this.logger.warn('actor_sweep_row_failed', {
      row_id: row.id,
      source_type: row.source_type,
      event_type: row.event_type,
      chain_id: row.chain_id,
      external_id: row.external_id,
      attempt,
      error: String(err),
    });

    if (attempt < ACTOR_SWEEP_DLQ_THRESHOLD) return;

    // ingestion_dlq has no external_id column — carry the off-chain identity in the payload,
    // mirroring the off-chain archive consumer's DLQ rows.
    await this.dlq.insert({
      stage: ACTOR_RESOLUTION_STAGE,
      source: 'indexer.actor_sweep',
      payload: {
        id: row.id,
        external_id: row.external_id,
        source_type: row.source_type,
        chain_id: row.chain_id,
        event_type: row.event_type,
      },
      error: { message: String(err) },
      retries: attempt,
      first_seen_at: new Date(),
      last_attempt_at: new Date(),
      archive_source_type: row.source_type,
      archive_chain_id: row.chain_id,
      archive_tx_hash: null,
      archive_log_index: null,
      archive_block_hash: null,
    });
  }

  private async handleFailure(row: ArchiveDerivationRow, err: unknown): Promise<void> {
    const attempt = await this.actorResolution.incrementActorResolutionAttemptCount(row.id);
    this.logger.warn('actor_sweep_row_failed', {
      row_id: row.id,
      source_type: row.source_type,
      event_type: row.event_type,
      chain_id: row.chain_id,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
      block_hash: row.block_hash,
      attempt,
      error: String(err),
    });

    if (attempt < ACTOR_SWEEP_DLQ_THRESHOLD) return;

    await this.dlq.insert({
      stage: ACTOR_RESOLUTION_STAGE,
      source: 'indexer.actor_sweep',
      payload: {
        id: row.id,
        source_type: row.source_type,
        chain_id: row.chain_id,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        block_hash: row.block_hash,
        event_type: row.event_type,
      },
      error: { message: String(err) },
      retries: attempt,
      first_seen_at: new Date(),
      last_attempt_at: new Date(),
      archive_source_type: row.source_type,
      archive_chain_id: row.chain_id,
      archive_tx_hash: row.tx_hash,
      archive_log_index: row.log_index,
      archive_block_hash: row.block_hash,
    });
  }
}

function groupBySourceType<T extends { source_type: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const rowsForSource = grouped.get(row.source_type);
    if (rowsForSource === undefined) {
      grouped.set(row.source_type, [row]);
    } else {
      rowsForSource.push(row);
    }
  }
  return grouped;
}

/** Correlation key between an archive row and its CH payload. Off-chain rows
 *  (external_id set) key on external_id; EVM rows key on the block/tx 4-tuple.
 *  EVM output is unchanged from the prior tuple key. */
export function archiveRowKey(row: {
  chain_id: string;
  tx_hash?: string | null;
  log_index?: number | null;
  block_hash?: string | null;
  external_id?: string | null;
}): string {
  if (row.external_id != null) return `${row.chain_id}:ext:${row.external_id}`;
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`;
}
