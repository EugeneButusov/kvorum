import { silentLogger } from '../logger.js';
import {
  getLogPollLagSeconds,
  getLogPollWindowBlocks,
  getLogsFetchedTotal,
  getLogsWithRemovedFlagTotal,
} from '../metrics/metrics.js';
import type { EventPollerOptions, EventsListener, LogEvent, LogFilter } from './types.js';
import { decodeLogEvent } from './utils/decode.utils.js';
import { lowercaseFilter } from './utils/filter.utils.js';

const DEFAULT_POLL_INTERVAL_MS = 12_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

/** Polls eth_getLogs over a sliding window of 2 × reorgHorizon blocks.
 *
 *  Tick-dropping contract: if listeners are slower than pollIntervalMs the re-entry
 *  guard drops the overlapping tick and logs a warn. No events are lost (next tick
 *  re-fetches the same window), but kvorum_ingestion_log_poll_lag_seconds grows
 *  unbounded under this condition — SPEC §6.20.2's alert fires on that gauge.
 *
 *  Cold-start gap: on indexer restart after downtime exceeding 2 × reorgHorizon blocks
 *  (~5 min at mainnet 12s), events in the gap fall outside the first tick's window.
 *  Filling that gap is a backfill responsibility, not E3's scope. */
export class EventPoller {
  private readonly logger;
  private readonly pollIntervalMs: number;
  private readonly stopTimeoutMs: number;
  private readonly chainName: string;
  private readonly daoSourceLabel: string;
  private readonly filter: LogFilter;
  private readonly listeners: Set<EventsListener> = new Set();

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private stopped = false;
  private startedAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private inFlightResolve: (() => void) | null = null;
  private inFlightPromise: Promise<void> | null = null;

  constructor(private readonly opts: EventPollerOptions) {
    this.logger = opts.logger ?? silentLogger;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.stopTimeoutMs = opts.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.chainName = opts.chainName;
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

  isRunning(): boolean {
    return !this.stopped && this.intervalHandle !== null;
  }

  /** Requires at least one listener registered via onEvents() — throws otherwise.
   *  Terminal-after-stop: a stopped poller cannot be restarted. */
  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error('EventPoller.start() called on a stopped poller — terminal-after-stop');
    }
    if (this.listeners.size === 0) {
      throw new Error(
        'EventPoller.start() requires at least one listener registered via onEvents()',
      );
    }
    this.startedAt = new Date();
    this.lastSuccessAt = new Date();
    await this.tick();
    if (this.stopped) return;
    this.intervalHandle = setInterval(() => {
      void this.scheduledTick();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.inFlightPromise) {
      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          this.logger.warn(
            `[chain:${this.chainName}][source:${this.daoSourceLabel}] EventPoller stop() deadline (${this.stopTimeoutMs}ms) exceeded — forcing shutdown`,
          );
          resolve();
        }, this.stopTimeoutMs),
      );
      await Promise.race([this.inFlightPromise, timeout]);
    }
  }

  private async scheduledTick(): Promise<void> {
    if (this.isPolling) {
      this.logger.warn(
        `[chain:${this.chainName}][source:${this.daoSourceLabel}] EventPoller tick skipped — previous tick still in flight`,
      );
      return;
    }
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    this.isPolling = true;
    let resolve!: () => void;
    this.inFlightPromise = new Promise<void>((r) => {
      resolve = r;
    });
    this.inFlightResolve = resolve;

    try {
      await this.runTick();
    } finally {
      this.isPolling = false;
      this.inFlightResolve = null;
      resolve();
      this.inFlightPromise = null;
    }
  }

  private async runTick(): Promise<void> {
    const { rpcClient, chainId, reorgHorizon, sourceType } = this.opts;
    const chain = this.chainName;
    const src = this.daoSourceLabel;

    let headBn: bigint;
    try {
      const headHex = await rpcClient.send<string>('eth_blockNumber', [], {
        deadlineMs: this.stopped ? this.stopTimeoutMs : undefined,
      });
      headBn = BigInt(headHex);
    } catch (err) {
      this.logger.warn(
        `[chain:${chain}][source:${src}] EventPoller eth_blockNumber failed: ${String(err)}`,
      );
      return;
    }

    const windowSize = BigInt(reorgHorizon) * 2n;
    const fromBn = headBn > windowSize ? headBn - windowSize : 0n;
    const fromHex = '0x' + fromBn.toString(16);
    const toHex = '0x' + headBn.toString(16);

    getLogPollWindowBlocks().set({ chain, dao_source: src }, Number(windowSize));

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
    getLogPollLagSeconds().set({ chain, dao_source: src }, 0);

    const events: LogEvent[] = [];
    for (const raw of rawLogs) {
      const log = raw as Record<string, unknown>;
      try {
        if (log['removed'] === true) {
          getLogsWithRemovedFlagTotal().inc({ chain, dao_source: src });
        }
        events.push(decodeLogEvent(log, sourceType, chainId));
      } catch (err) {
        this.logger.error(
          `[chain:${chain}][source:${src}] EventPoller dropping malformed log: ${String(err)}`,
        );
      }
    }

    getLogsFetchedTotal().inc({ chain, dao_source: src }, events.length);

    if (events.length > 0) {
      await Promise.allSettled(
        [...this.listeners].map(async (listener) => {
          try {
            await listener(events);
          } catch (err) {
            this.logger.error(
              `[chain:${chain}][source:${src}] EventPoller listener threw: ${String(err)}`,
            );
          }
        }),
      );
    }
  }
}
