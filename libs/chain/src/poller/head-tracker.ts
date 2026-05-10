import { silentLogger } from '../logger.js';
import { getHeadBlockAgeSeconds, getHeadPollLagSeconds } from '../metrics/metrics.js';
import type { Head, HeadListener, HeadTrackerOptions } from './types.js';

const DEFAULT_POLL_INTERVAL_MS = 12_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

function requireHex(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/i.test(value)) {
    throw new Error(`missing or non-hex ${field}`);
  }
  return value;
}

function decodeHead(raw: unknown, chainId: number, observedAt: Date): Head {
  if (!raw || typeof raw !== 'object') {
    throw new Error('block response is not an object');
  }
  const block = raw as Record<string, unknown>;
  return {
    chainId,
    blockNumber: BigInt(requireHex(block['number'], 'number')),
    blockHash: requireHex(block['hash'], 'hash').toLowerCase(),
    parentHash: requireHex(block['parentHash'], 'parentHash').toLowerCase(),
    timestamp: BigInt(requireHex(block['timestamp'], 'timestamp')),
    observedAt,
  };
}

/** Polls eth_getBlockByNumber('latest', false) and fans out to registered listeners.
 *
 *  Emits every tick even when block is unchanged — the freshness signal is informative
 *  on its own; change-only emission would conflate "no new block" with "tracker stalled."
 *
 *  Listeners are dispatched sequentially because head listeners are sub-millisecond
 *  (E4's parent-hash compare is in-memory) and ordering simplifies E4's reasoning. */
export class HeadTracker {
  private readonly logger;
  private readonly pollIntervalMs: number;
  private readonly stopTimeoutMs: number;
  private readonly chainName: string;
  private readonly listeners: Set<HeadListener> = new Set();

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private isPolling = false;
  private lastHead: Head | null = null;
  private lastSuccessAt: Date | null = null;
  private inFlightPromise: Promise<void> | null = null;

  private firstHeadResolvers: Array<{ resolve: (h: Head) => void; reject: (e: Error) => void }> =
    [];

  constructor(private readonly opts: HeadTrackerOptions) {
    this.logger = opts.logger ?? silentLogger;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.stopTimeoutMs = opts.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.chainName = opts.chainName;
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

  /** Terminal-after-stop: a stopped tracker cannot be restarted. */
  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error('HeadTracker.start() called on a stopped tracker — terminal-after-stop');
    }
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
    for (const { reject } of this.firstHeadResolvers) {
      reject(new Error('HeadTracker stopped before first head'));
    }
    this.firstHeadResolvers = [];
    if (this.inFlightPromise) {
      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          this.logger.warn(
            `[chain:${this.chainName}] HeadTracker stop() deadline (${this.stopTimeoutMs}ms) exceeded — forcing shutdown`,
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
        `[chain:${this.chainName}] HeadTracker tick skipped — previous tick still in flight`,
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

    try {
      await this.runTick();
    } finally {
      this.isPolling = false;
      resolve();
      this.inFlightPromise = null;
    }
  }

  private async runTick(): Promise<void> {
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
