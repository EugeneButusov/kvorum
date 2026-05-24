import { AbstractPoller } from './abstract-poller.js';
import type { EventPollerOptions, EventsListener, LogEvent, LogFilter } from './types.js';
import { readConfirmedHead } from '../confirmed-head.js';
import { chainMetrics } from '../metrics/metrics.js';
import { decodeLogEvent } from './utils/decode.utils.js';
import { lowercaseFilter } from './utils/filter.utils.js';

const PROGRESS_LOG_BLOCK_INTERVAL = 50n;
const PROGRESS_LOG_MS = 5 * 60 * 1_000;

/** Polls eth_getLogs over a sliding window anchored at confirmed head.
 *
 *  Tick-dropping contract: if listeners are slower than pollIntervalMs the re-entry
 *  guard drops the overlapping tick and logs a warn. No events are lost (next tick
 *  re-fetches the same window), but ingestion_log_poll_lag_seconds grows
 *  unbounded under this condition — SPEC §6.20.2's alert fires on that gauge.
 *
 *  Cold-start gap: on indexer restart after downtime exceeding 2 × headLag blocks
 *  (~5 min at mainnet 12s), events in the gap fall outside the first tick's window.
 *  Filling that gap is a backfill responsibility, not E3's scope. */
export class EventPoller extends AbstractPoller {
  private readonly daoSourceLabel: string;
  private readonly filter: LogFilter;
  private readonly listeners: Set<EventsListener> = new Set();
  private lastSuccessAt: Date | null = null;
  private lastLoggedHead: bigint = 0n;
  private lastLoggedAt: number = 0;
  private firstTickFired = false;

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

    const windowSize = BigInt(headLag) * 2n;
    const fromBn = headBn > windowSize ? headBn - windowSize : 0n;
    const fromHex = '0x' + fromBn.toString(16);
    const toHex = '0x' + headBn.toString(16);

    chainMetrics.logPollWindowBlocks.record(Number(windowSize), { chain, dao_source: src });

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
    if (
      headBn - this.lastLoggedHead >= PROGRESS_LOG_BLOCK_INTERVAL ||
      now - this.lastLoggedAt >= PROGRESS_LOG_MS
    ) {
      this.logger.info('poller_tick', {
        head: Number(headBn),
        advanced: Number(headBn - this.lastLoggedHead),
        source: src,
        chain,
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

    if (!allListenersFulfilled) return;
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
}
