import { FailoverRpcClient, HeadTracker, ReorgDetector } from '@libs/chain';
import type { ChainConfig } from '@libs/chain';
import { ChainContextRegistry } from '../../src/orchestrator/chain-context-registry';
import type { ChainContext } from '../../src/orchestrator/chain-context-registry';

export interface AnvilTestContext {
  client: FailoverRpcClient;
  headTracker: HeadTracker;
  reorgDetector: ReorgDetector;
  registry: ChainContextRegistry;
  ctx: ChainContext;
  cleanup: () => Promise<void>;
}

export async function createAnvilTestContext(chainCfg: ChainConfig): Promise<AnvilTestContext> {
  const registry = new ChainContextRegistry();
  const ctx = await registry.getOrCreate(chainCfg);

  return {
    client: ctx.client,
    headTracker: ctx.headTracker,
    reorgDetector: ctx.reorgDetector,
    registry,
    ctx,
    cleanup: () => registry.drainAll(),
  };
}
