import { ChainContextRegistry, FailoverRpcClient, HeadTracker, ReorgDetector } from '@libs/chain';
import type { ChainConfig, ChainContext } from '@libs/chain';
import { pollUntil } from './pg-test-fixtures';

export interface AnvilTestContext {
  client: FailoverRpcClient;
  headTracker: HeadTracker;
  reorgDetector: ReorgDetector;
  registry: ChainContextRegistry;
  ctx: ChainContext;
  cleanup: () => Promise<void>;
}

/** Wait until the HeadTracker on a ChainContext has observed at least the given block number. */
export async function awaitHead(ctx: ChainContext, target: number): Promise<void> {
  await pollUntil(
    () => Promise.resolve((ctx.headTracker.getLastHead()?.blockNumber ?? -1n) >= BigInt(target)),
    5_000,
    50,
  );
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
