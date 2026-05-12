import { FailoverRpcClient, HeadTracker, ReorgDetector } from '@libs/chain';
import type { ChainConfig, Logger } from '@libs/chain';

export interface ChainContext {
  client: FailoverRpcClient;
  headTracker: HeadTracker;
  reorgDetector: ReorgDetector;
  chainCfg: ChainConfig;
}

interface ChainEntry {
  ctx: ChainContext;
  refCount: number;
}

const HEAD_POLL_INTERVAL_MS = Number(process.env['HEAD_POLL_INTERVAL_MS'] ?? 6_000);

export class ChainContextRegistry {
  private readonly map = new Map<number, ChainEntry>();
  private readonly logger: Logger | undefined;

  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private readonly readyPromise: Promise<void>;
  private readySettled = false;

  constructor(logger?: Logger) {
    this.logger = logger;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  async acquire(chainCfg: ChainConfig): Promise<ChainContext> {
    const existing = this.map.get(chainCfg.chainId);
    if (existing) {
      existing.refCount++;
      return existing.ctx;
    }

    const client = new FailoverRpcClient(chainCfg);
    try {
      await client.start();
    } catch (err) {
      throw err;
    }

    const headTracker = new HeadTracker({
      rpcClient: client,
      chainId: chainCfg.chainId,
      chainName: chainCfg.name,
      pollIntervalMs: HEAD_POLL_INTERVAL_MS,
      stopTimeoutMs: 5_000,
      logger: this.logger,
    });

    const reorgDetector = new ReorgDetector({
      rpcClient: client,
      chainId: chainCfg.chainId,
      chainName: chainCfg.name,
      reorgHorizon: chainCfg.reorgHorizon,
      logger: this.logger,
    });

    reorgDetector.attach(headTracker);
    await headTracker.start();

    const ctx: ChainContext = { client, headTracker, reorgDetector, chainCfg };
    this.map.set(chainCfg.chainId, { ctx, refCount: 1 });
    return ctx;
  }

  async release(chainId: number): Promise<void> {
    const entry = this.map.get(chainId);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount > 0) return;

    this.map.delete(chainId);
    await entry.ctx.headTracker.stop();
    await entry.ctx.client.stop();
  }

  async drainAll(): Promise<void> {
    const entries = Array.from(this.map.values());
    this.map.clear();
    await Promise.allSettled(
      entries.flatMap((e) => [e.ctx.headTracker.stop(), e.ctx.client.stop()]),
    );
  }

  peek(chainId: number): ChainContext | undefined {
    return this.map.get(chainId)?.ctx;
  }

  allActive(): ChainContext[] {
    return Array.from(this.map.values()).map((e) => e.ctx);
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  markReady(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.readyResolve!();
  }

  markFailed(err: Error): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.readyReject!(err);
  }
}
