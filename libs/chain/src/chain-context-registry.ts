import { FailoverRpcClient } from './client/failover-rpc-client.js';
import type { ChainConfig } from './config/config.js';
import { HeadTracker } from './poller/head-tracker.js';
import { ProxyResolver } from './proxy/proxy-resolver.js';
import { ReorgDetector } from './reorg/reorg-detector.js';

export interface ChainContext {
  client: FailoverRpcClient;
  headTracker: HeadTracker;
  reorgDetector: ReorgDetector;
  chainCfg: ChainConfig;
  proxyResolver: ProxyResolver;
}

export class ChainContextRegistry {
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

    const proxyResolver = new ProxyResolver({ rpcClient: client, chainName: chainCfg.name });

    const ctx: ChainContext = { client, headTracker, reorgDetector, chainCfg, proxyResolver };
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
