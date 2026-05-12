import { Injectable, Logger } from '@nestjs/common';
import { FailoverRpcClient, HeadTracker, ReorgDetector } from '@libs/chain';
import type { ChainConfig } from '@libs/chain';

export interface ChainContext {
  client: FailoverRpcClient;
  headTracker: HeadTracker;
  reorgDetector: ReorgDetector;
  chainCfg: ChainConfig;
}

export interface ChainLease extends ChainContext {
  /** Idempotent: decrements the ref-count; stops chain resources when the last lease is released. */
  release(): Promise<void>;
}

interface ChainEntry {
  ctx: ChainContext;
  refCount: number;
}

const HEAD_POLL_INTERVAL_MS = Number(process.env['HEAD_POLL_INTERVAL_MS'] ?? 6_000);

@Injectable()
export class ChainContextRegistry {
  private readonly logger = new Logger('ChainContextRegistry');
  private readonly map = new Map<string, ChainEntry>();

  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private readonly readyPromise: Promise<void>;
  private readySettled = false;

  constructor() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  async lease(chainCfg: ChainConfig): Promise<ChainLease> {
    const existing = this.map.get(chainCfg.chainId);
    if (existing) {
      existing.refCount++;
      return this.makeLease(existing.ctx, chainCfg.chainId);
    }

    const client = new FailoverRpcClient(chainCfg);
    await client.start();

    const headTracker = new HeadTracker({
      rpcClient: client,
      chainId: chainCfg.chainId,
      chainName: chainCfg.name,
      pollIntervalMs: HEAD_POLL_INTERVAL_MS,
      stopTimeoutMs: 5_000,
    });

    const reorgDetector = new ReorgDetector({
      rpcClient: client,
      chainId: chainCfg.chainId,
      chainName: chainCfg.name,
      reorgHorizon: chainCfg.reorgHorizon,
    });

    reorgDetector.attach(headTracker);
    await headTracker.start();

    const ctx: ChainContext = { client, headTracker, reorgDetector, chainCfg };
    this.map.set(chainCfg.chainId, { ctx, refCount: 1 });
    return this.makeLease(ctx, chainCfg.chainId);
  }

  async drainAll(): Promise<void> {
    const entries = Array.from(this.map.values());
    this.map.clear();
    await Promise.allSettled(
      entries.flatMap((e) => [e.ctx.headTracker.stop(), e.ctx.client.stop()]),
    );
  }

  peek(chainId: string): ChainContext | undefined {
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

  private makeLease(ctx: ChainContext, chainId: string): ChainLease {
    let released = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      const entry = this.map.get(chainId);
      if (!entry) return;
      entry.refCount--;
      if (entry.refCount > 0) return;
      this.map.delete(chainId);
      await entry.ctx.headTracker.stop();
      await entry.ctx.client.stop();
    };
    return { ...ctx, release };
  }
}
