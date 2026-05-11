import { AbstractPoller } from './abstract-poller.js';
import type { Head, HeadListener, HeadTrackerOptions } from './types.js';
import { getHeadBlockAgeSeconds, getHeadPollLagSeconds } from '../metrics/metrics.js';
import { decodeHead } from './utils/decode.utils.js';

/** Polls eth_getBlockByNumber('latest', false) and fans out to registered listeners.
 *
 *  Emits every tick even when block is unchanged — the freshness signal is informative
 *  on its own; change-only emission would conflate "no new block" with "tracker stalled."
 *
 *  Listeners are dispatched sequentially because head listeners are sub-millisecond
 *  (E4's parent-hash compare is in-memory) and ordering simplifies E4's reasoning. */
export class HeadTracker extends AbstractPoller {
  private readonly listeners: Set<HeadListener> = new Set();
  private lastHead: Head | null = null;
  private lastSuccessAt: Date | null = null;

  private firstHeadResolvers: Array<{ resolve: (h: Head) => void; reject: (e: Error) => void }> =
    [];

  constructor(private readonly opts: HeadTrackerOptions) {
    super({
      chainName: opts.chainName,
      pollIntervalMs: opts.pollIntervalMs,
      stopTimeoutMs: opts.stopTimeoutMs,
      logger: opts.logger,
    });
  }

  /** Returns an unsubscribe function. Listeners are invoked sequentially per tick. */
  onHead(listener: HeadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Snapshot only. Returns null before the first successful tick. */
  getLastHead(): Head | null {
    return this.lastHead;
  }

  /** Resolves with the cached head if one is already known, otherwise with the next head
   *  observed after the call. Rejects immediately if the tracker is stopped, or if stop()
   *  is called before the first head arrives. */
  awaitFirstHead(): Promise<Head> {
    if (this.lastHead !== null) return Promise.resolve(this.lastHead);
    if (this.stopped) {
      return Promise.reject(new Error('HeadTracker stopped before first head'));
    }
    return new Promise<Head>((resolve, reject) => {
      this.firstHeadResolvers.push({ resolve, reject });
    });
  }

  protected override logContext(): string {
    return `[chain:${this.chainName}] HeadTracker`;
  }

  protected override validateStart(): void {
    this.lastSuccessAt = new Date();
  }

  protected override onStopBeforeRace(): void {
    for (const { reject } of this.firstHeadResolvers) {
      reject(new Error('HeadTracker stopped before first head'));
    }
    this.firstHeadResolvers = [];
  }

  protected override async runTick(): Promise<void> {
    const { rpcClient, chainId } = this.opts;
    const chain = this.chainName;

    let raw: Record<string, unknown>;
    try {
      raw = await rpcClient.send<Record<string, unknown>>(
        'eth_getBlockByNumber',
        ['latest', false],
        { deadlineMs: this.stopped ? this.stopTimeoutMs : undefined },
      );
    } catch (err) {
      this.logger.warn(`[chain:${chain}] HeadTracker eth_getBlockByNumber failed: ${String(err)}`);
      return;
    }

    let head: Head;
    const now = new Date();
    try {
      head = decodeHead(raw, chainId, now);
    } catch (err) {
      this.logger.error(
        `[chain:${chain}] HeadTracker received malformed block response: ${String(err)}`,
      );
      return;
    }

    this.lastHead = head;
    this.lastSuccessAt = now;

    const ageSec = now.getTime() / 1000 - Number(head.timestamp);
    getHeadBlockAgeSeconds().set({ chain }, ageSec);
    getHeadPollLagSeconds().set({ chain }, 0);

    const resolvers = this.firstHeadResolvers.splice(0);
    for (const { resolve } of resolvers) {
      resolve(head);
    }

    for (const listener of this.listeners) {
      try {
        await listener(head);
      } catch (err) {
        this.logger.error(`[chain:${chain}] HeadTracker listener threw: ${String(err)}`);
      }
    }
  }
}
