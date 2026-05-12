import { Injectable, Logger } from '@nestjs/common';
import { FailoverRpcClient, HeadTracker, ReorgDetector } from '@libs/chain';
import type { ChainConfig } from '@libs/chain';

export interface ChainContext {
  client: FailoverRpcClient;
  headTracker: HeadTracker;
  reorgDetector: ReorgDetector;
  chainCfg: ChainConfig;
}

@Injectable()
export class ChainContextRegistry {
  private readonly logger = new Logger('ChainContextRegistry');
  private readonly map = new Map<string, ChainContext>();

  async getOrCreate(chainCfg: ChainConfig): Promise<ChainContext> {
    const existing = this.map.get(chainCfg.chainId);
    if (existing) return existing;

    const client = new FailoverRpcClient(chainCfg);
    await client.start();

    const headPollIntervalMs =
      chainCfg.headPollIntervalMs ?? Number(process.env['HEAD_POLL_INTERVAL_MS'] ?? 6_000);

    const headTracker = new HeadTracker({
      rpcClient: client,
      chainId: chainCfg.chainId,
      chainName: chainCfg.name,
      pollIntervalMs: headPollIntervalMs,
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
    return ctx;
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
}
