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
  /** Idempotent: tears down chain resources on first call; subsequent calls are no-ops. */
  release(): Promise<void>;
}

const HEAD_POLL_INTERVAL_MS = Number(process.env['HEAD_POLL_INTERVAL_MS'] ?? 6_000);

@Injectable()
export class ChainContextRegistry {
  private readonly logger = new Logger('ChainContextRegistry');
  private readonly map = new Map<string, ChainContext>();

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
      return this.makeLease(existing, chainCfg.chainId);
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
    this.map.set(chainCfg.chainId, ctx);
    return this.makeLease(ctx, chainCfg.chainId);
  }

  async drainAll(): Promise<void> {
    const contexts = Array.from(this.map.values());
    this.map.clear();
    await Promise.allSettled(
      contexts.flatMap((ctx) => [ctx.headTracker.stop(), ctx.client.stop()]),
    );
  }

  peek(chainId: string): ChainContext | undefined {
    return this.map.get(chainId);
  }

  allActive(): ChainContext[] {
    return Array.from(this.map.values());
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
      if (!this.map.delete(chainId)) return;
      await ctx.headTracker.stop();
      await ctx.client.stop();
    };
    return { ...ctx, release };
  }
}
