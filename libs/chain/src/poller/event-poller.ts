import { AbstractPoller } from './abstract-poller.js';
import type { EventPollerOptions, EventsListener, LogEvent, LogFilter } from './types.js';
import { readConfirmedHead } from '../confirmed-head.js';
import { chainMetrics } from '../metrics/metrics.js';
import { decodeLogEvent } from './utils/decode.utils.js';
import { lowercaseFilter } from './utils/filter.utils.js';

const PROGRESS_LOG_BLOCK_INTERVAL = 50n;
const PROGRESS_LOG_MS = 5 * 60 * 1_000;
/** Providers cap eth_getLogs block ranges; 500 stays well inside the common limits. */
const DEFAULT_MAX_BLOCKS_PER_TICK = 500;

/** Polls eth_getLogs forward from a per-source watermark up to confirmed head.
 *
 *  Tick-dropping contract: if listeners are slower than pollIntervalMs the re-entry
 *  guard drops the overlapping tick and logs a warn. No events are lost (the cursor
 *  only advances once a batch is accepted, so the next tick re-fetches the same
 *  range), but ingestion_log_poll_lag_seconds grows unbounded under this condition
 *  — SPEC §6.20.2's alert fires on that gauge.
 *
 *  Catch-up: with a `cursor` the poller resumes from the last accepted block and
 *  walks forward in `maxBlocksPerTick` chunks until it reaches confirmed head, so
 *  downtime costs latency rather than data. The cursor advances only after every
 *  listener resolves, so a failing listener re-reads its range instead of skipping
 *  it — at the cost of stalling that source until it recovers, which the lag gauge
 *  surfaces. That trade is deliberate: a visible stall beats a silent hole.
 *
 *  Without a `cursor` the poller keeps its legacy behaviour — a sliding window
 *  anchored at confirmed head — and any downtime beyond 2 × headLag blocks (~5 min
 *  at mainnet 12s) leaves an unread gap that only a backfill can fill. */
export class EventPoller extends AbstractPoller {
  private readonly daoSourceLabel: string;
  private readonly filter: LogFilter;
  private readonly listeners: Set<EventsListener> = new Set();
  private lastSuccessAt: Date | null = null;
  private lastLoggedHead: bigint = 0n;
  private lastLoggedAt: number = 0;
  private firstTickFired = false;
  /** In-memory mirror of the cursor: read through on the first tick, written through thereafter, so
   *  the steady state costs no extra read per tick. `undefined` = not yet loaded. */
  private lastPolled: bigint | null | undefined = undefined;

  constructor(private readonly opts: EventPollerOptions) {
    super({
      chainName: opts.chainName,
      pollIntervalMs: opts.pollIntervalMs,
      stopTimeoutMs: opts.stopTimeoutMs,
      logger: opts.logger,
    });
    this.daoSourceLabel = opts.daoSourceLabel;
    this.filter = Object.freeze(lowercaseFilter(opts.filter));
  }

  /** Returns an unsubscribe function. Listeners are dispatched in parallel via
   *  Promise.allSettled; one slow or throwing listener does not block others. */
  onEvents(listener: EventsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected override logContext(): string {
    return `[chain:${this.chainName}][source:${this.daoSourceLabel}] EventPoller`;
  }

  protected override validateStart(): void {
    if (this.listeners.size === 0) {
      throw new Error(
        'EventPoller.start() requires at least one listener registered via onEvents()',
      );
    }
    this.lastSuccessAt = new Date();
  }

  protected override async runTick(): Promise<void> {
    const { rpcClient, chainId, headLag, sourceType } = this.opts;
    const chain = this.chainName;
    const src = this.daoSourceLabel;

    let headBn: bigint;
    try {
      headBn = await readConfirmedHead(rpcClient, { name: chain, headLag }, src);
    } catch (err) {
      this.logger.warn(
        `[chain:${chain}][source:${src}] EventPoller readConfirmedHead failed: ${String(err)}`,
      );
      return;
    }

    const range = await this.resolveRange(headBn);
    if (range === undefined) return;
    const { fromBn, toBn } = range;

    const fromHex = '0x' + fromBn.toString(16);
    const toHex = '0x' + toBn.toString(16);

    chainMetrics.logPollWindowBlocks.record(Number(toBn - fromBn + 1n), {
      chain,
      dao_source: src,
    });

    let rawLogs: unknown[];
    try {
      const filter = this.filter;
      rawLogs = await rpcClient.send<unknown[]>(
        'eth_getLogs',
        [{ fromBlock: fromHex, toBlock: toHex, address: filter.address, topics: filter.topics }],
        { deadlineMs: this.stopped ? this.stopTimeoutMs : undefined },
      );
    } catch (err) {
      this.logger.warn(
        `[chain:${chain}][source:${src}] EventPoller eth_getLogs failed: ${String(err)}`,
      );
      return;
    }

    this.lastSuccessAt = new Date();
    chainMetrics.logPollLag.record(0, { chain, dao_source: src });

    const now = Date.now();
    const behind = headBn - toBn;
    if (
      headBn - this.lastLoggedHead >= PROGRESS_LOG_BLOCK_INTERVAL ||
      now - this.lastLoggedAt >= PROGRESS_LOG_MS ||
      behind > 0n
    ) {
      this.logger.info('poller_tick', {
        head: Number(headBn),
        advanced: Number(headBn - this.lastLoggedHead),
        source: src,
        chain,
        // > 0 while walking a backlog; 0 once the source is at confirmed head.
        blocks_behind: Number(behind),
      });
      this.lastLoggedHead = headBn;
      this.lastLoggedAt = now;
    }

    const events: LogEvent[] = [];
    for (const raw of rawLogs) {
      const log = raw as Record<string, unknown>;
      try {
        if (log['removed'] === true) {
          chainMetrics.logsWithRemovedFlag.add(1, { chain, dao_source: src });
        }
        events.push(decodeLogEvent(log, sourceType, chainId));
      } catch (err) {
        this.logger.error(
          `[chain:${chain}][source:${src}] EventPoller dropping malformed log: ${String(err)}`,
        );
      }
    }

    chainMetrics.logsFetched.add(events.length, { chain, dao_source: src });

    let allListenersFulfilled = true;
    if (events.length > 0) {
      const listenerResults = await Promise.allSettled(
        [...this.listeners].map(async (listener) => listener(events)),
      );
      for (const result of listenerResults) {
        if (result.status === 'rejected') {
          allListenersFulfilled = false;
          this.logger.error(
            `[chain:${chain}][source:${src}] EventPoller listener rejected: ${String(result.reason)}`,
          );
        }
      }
    }

    // A rejected listener leaves the cursor where it was, so the next tick re-fetches this exact
    // range. That is the whole durability contract: never advance past a batch nobody accepted.
    if (!allListenersFulfilled) return;

    await this.advanceCursor(toBn);

    if (!this.firstTickFired) {
      this.firstTickFired = true;
      try {
        this.opts.onFirstHeadComplete?.(headBn);
      } catch (err) {
        this.logger.warn(
          `[chain:${chain}][source:${src}] EventPoller onFirstHeadComplete threw: ${String(err)}`,
        );
      }
    }
  }

  /**
   * The block range this tick should fetch, or undefined when there is nothing new.
   *
   * With a cursor: resume just past the last accepted block, capped at `maxBlocksPerTick` so a long
   * backlog is walked in provider-sized chunks instead of demanded in one eth_getLogs call. Without
   * one (or on a source never seen before): the legacy confirmed-head window, which bounds the very
   * first fetch of a brand-new source to minutes rather than all of history — reaching back through
   * history is a backfill's job.
   */
  private async resolveRange(
    headBn: bigint,
  ): Promise<{ fromBn: bigint; toBn: bigint } | undefined> {
    const { headLag, cursor } = this.opts;
    const windowSize = BigInt(headLag) * 2n;
    const headWindowFrom = headBn > windowSize ? headBn - windowSize : 0n;

    if (cursor === undefined) return { fromBn: headWindowFrom, toBn: headBn };

    if (this.lastPolled === undefined) {
      try {
        this.lastPolled = await cursor.read();
      } catch (err) {
        this.logger.warn(`${this.logContext()} cursor read failed, skipping tick: ${String(err)}`);
        return undefined;
      }
    }

    if (this.lastPolled === null) return { fromBn: headWindowFrom, toBn: headBn };

    const fromBn = this.lastPolled + 1n;
    // Already at (or ahead of) confirmed head — nothing has been mined into the confirmed zone yet.
    if (fromBn > headBn) return undefined;

    const maxSpan = BigInt(this.opts.maxBlocksPerTick ?? DEFAULT_MAX_BLOCKS_PER_TICK);
    const toBn = headBn - fromBn + 1n > maxSpan ? fromBn + maxSpan - 1n : headBn;
    return { fromBn, toBn };
  }

  private async advanceCursor(toBn: bigint): Promise<void> {
    const { cursor } = this.opts;
    if (cursor === undefined) return;
    try {
      await cursor.write(toBn);
      this.lastPolled = toBn;
    } catch (err) {
      // Leave the in-memory watermark untouched: the next tick re-fetches this range and the writes
      // are idempotent on the archive 4-tuple (ADR-041), so a failed persist costs work, not data.
      this.logger.error(`${this.logContext()} cursor write failed: ${String(err)}`);
    }
  }
}
