import type { ChainConfig, Logger, RpcClient } from '@libs/chain';
import type { DaoSourceRepository } from '@libs/db';
import type { BackfillOutcome, BackfillRunInput, BackfillRuntime } from '@sources/core';

export interface RunSourceBackfillInput {
  rpcClient: RpcClient;
  daoSourceRepo: DaoSourceRepository;
  chainConfig: ChainConfig;
  runtime: BackfillRuntime;
  run: BackfillRunInput;
  logger: Logger;
}

/**
 * Runs one source's backfill through the BackfillDriver and clears the checkpoint columns on
 * natural completion. Shared by `backfill start` (single source) and `backfill run` (the
 * orchestrator drives this per source under one AbortController + RPC pool), so cancellation and
 * completion semantics stay identical across both entry points.
 */
export async function runSourceBackfill(input: RunSourceBackfillInput): Promise<BackfillOutcome> {
  const { BackfillDriver } = await import('@sources/core');
  const driver = new BackfillDriver({
    rpcClient: input.rpcClient,
    daoSourceRepo: input.daoSourceRepo,
    chainConfig: input.chainConfig,
    filter: input.runtime.filter,
    listenerFactory: input.runtime.listenerFactory,
    logger: input.logger,
  });
  const outcome = await driver.run(input.run);
  if (outcome.status === 'completed') {
    await input.daoSourceRepo.clearBackfillState(input.run.daoSourceId);
  }
  return outcome;
}
