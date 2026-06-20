import { AbstractPoller } from '@libs/chain';
import type { AbstractPollerOptions, Logger } from '@libs/chain';
import { raceWithAbort } from '@libs/utils';
import type { SourceContext, PollListener, PollQueuePort, PollPollContext } from '@sources/core';
import { pollMetrics } from './poll-metrics';

const DEFAULT_TICK_TIMEOUT_MS = 30_000;
const DEFAULT_MIN_INTERVAL_MS = 5_000;

export interface PollSourcePollerOpts {
  source: SourceContext;
  listener: PollListener<unknown>;
  enqueuePort: PollQueuePort;
  /** Per-tick deadline before giving up and recording result=timeout. Defaults to POLL_TICK_TIMEOUT_MS env or 30s. */
  tickTimeoutMs?: number;
  /** Minimum allowed poll interval regardless of listener.intervalMs. Defaults to POLL_MIN_INTERVAL_MS env or 5s. */
  minIntervalMs?: number;
  stopTimeoutMs?: AbstractPollerOptions['stopTimeoutMs'];
  logger?: Logger;
}

/** AbstractPoller subclass that drives one off-chain poll source.
 *
 *  Inherits from AbstractPoller: single-flight re-entry guard, terminal-after-stop,
 *  immediate first tick, and the hard stopTimeoutMs race on shutdown (ADR-071).
 *
 *  runTick() races poll() against a per-tick deadline so a hung HTTP call cannot
 *  block drain()/onApplicationShutdown() beyond stopTimeoutMs. */
export class PollSourcePoller extends AbstractPoller {
  private readonly source: SourceContext;
  private readonly listener: PollListener<unknown>;
  private readonly enqueuePort: PollQueuePort;
  private readonly tickTimeoutMs: number;
  private cursor: unknown = null;

  constructor(opts: PollSourcePollerOpts) {
    const minIntervalMs =
      opts.minIntervalMs ?? Number(process.env['POLL_MIN_INTERVAL_MS'] ?? DEFAULT_MIN_INTERVAL_MS);
    super({
      chainName: opts.source.sourceType,
      pollIntervalMs: Math.max(opts.listener.intervalMs, minIntervalMs),
      stopTimeoutMs: opts.stopTimeoutMs,
      logger: opts.logger,
    });
    this.source = opts.source;
    this.listener = opts.listener;
    this.enqueuePort = opts.enqueuePort;
    this.tickTimeoutMs =
      opts.tickTimeoutMs ?? Number(process.env['POLL_TICK_TIMEOUT_MS'] ?? DEFAULT_TICK_TIMEOUT_MS);
  }

  protected logContext(): string {
    return `[poll:${this.source.sourceType}:${this.source.daoSourceId}]`;
  }

  protected async runTick(): Promise<void> {
    const tickAbort = new AbortController();
    const timeoutId = setTimeout(() => tickAbort.abort('tick-timeout'), this.tickTimeoutMs);
    const ctx: PollPollContext = { source: this.source, signal: tickAbort.signal };

    let result: Awaited<ReturnType<PollListener<unknown>['poll']>>;
    try {
      result = await raceWithAbort(this.listener.poll(ctx, this.cursor), tickAbort.signal);
      clearTimeout(timeoutId);
    } catch {
      clearTimeout(timeoutId);
      const isTimeout = tickAbort.signal.aborted && tickAbort.signal.reason === 'tick-timeout';
      pollMetrics.pollTick.add(1, {
        source_type: this.source.sourceType,
        result: isTimeout ? 'timeout' : 'error',
      });
      return;
    }

    for (const item of result.items) {
      await this.enqueuePort.enqueue(this.source, item);
    }
    this.cursor = result.nextCursor;

    pollMetrics.pollItemsEnqueued.add(result.items.length, {
      source_type: this.source.sourceType,
    });
    pollMetrics.pollTick.add(1, { source_type: this.source.sourceType, result: 'ok' });
    pollMetrics.pollLastSuccess.record(Date.now() / 1000, {
      source_type: this.source.sourceType,
    });
  }
}
