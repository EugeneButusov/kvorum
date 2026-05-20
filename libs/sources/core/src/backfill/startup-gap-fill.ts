import type { ChainConfig, Logger, RpcClient } from '@libs/chain';
import type { DaoSourceRepository, PgDatabase } from '@libs/db';
import type { Kysely } from 'kysely';
import { BackfillDriver } from './backfill-driver';
import { withDaoSourceAdvisoryLock } from './dao-source-lock';
import { computeGap } from './gap-detector';
import type { BackfillRuntime } from './types';

export type StartupGapFillResult =
  | { status: 'filled'; fromBlock: bigint; toBlock: bigint }
  | { status: 'no_gap' }
  | { status: 'skipped'; reason: 'no_active_from_block' }
  | { status: 'cancelled' }
  | { status: 'error'; error: unknown };

export interface StartupGapFillInput {
  daoSourceId: string;
  chainConfig: ChainConfig;
  rpcClient: RpcClient;
  daoSourceRepo: DaoSourceRepository;
  runtime: BackfillRuntime;
  logger: Logger;
  signal?: AbortSignal;
}

export type StartupGapFillWithLockResult =
  | { status: 'contended' }
  | { status: 'executed'; value: StartupGapFillResult };

export interface StartupGapFillWithLockInput extends StartupGapFillInput {
  db: Kysely<PgDatabase>;
}

export async function runStartupGapFill(input: StartupGapFillInput): Promise<StartupGapFillResult> {
  const { daoSourceId, chainConfig, rpcClient, daoSourceRepo, runtime, logger, signal } = input;

  const row = await daoSourceRepo.findByIdWithChain(daoSourceId);
  if (!row) throw new Error(`dao_source ${daoSourceId} not found`);

  const headHex = await rpcClient.send<string>('eth_blockNumber', []);
  const headBlock = BigInt(headHex);

  const gap = computeGap({
    row: {
      active_from_block: row.active_from_block,
      backfill_head_block: row.backfill_head_block,
      live_head_block: row.live_head_block,
    },
    headBlock,
    reorgHorizon: chainConfig.reorgHorizon,
  });

  if (gap.kind === 'skip') return { status: 'skipped', reason: gap.reason };
  if (gap.kind === 'none') return { status: 'no_gap' };

  const driver = new BackfillDriver({
    rpcClient,
    daoSourceRepo,
    chainConfig,
    filter: runtime.filter,
    listenerFactory: runtime.listenerFactory,
    logger,
  });

  const outcome = await driver.run({
    daoSourceId,
    fromBlock: gap.gapStart,
    toBlock: gap.gapEnd,
    mode: 'fresh',
    force: true,
    signal,
  });

  if (outcome.status === 'completed') {
    await daoSourceRepo.clearBackfillState(daoSourceId);
    return { status: 'filled', fromBlock: outcome.fromBlock, toBlock: outcome.toBlock };
  }
  if (outcome.status === 'cancelled') {
    return { status: 'cancelled' };
  }
  return { status: 'error', error: outcome.error };
}

export async function runStartupGapFillWithLock(
  input: StartupGapFillWithLockInput,
): Promise<StartupGapFillWithLockResult> {
  const { db, daoSourceId, ...gapFillInput } = input;
  const lockResult = await withDaoSourceAdvisoryLock({
    db,
    daoSourceId,
    run: async () => runStartupGapFill({ daoSourceId, ...gapFillInput }),
  });
  if (lockResult.status === 'contended') return { status: 'contended' };
  return { status: 'executed', value: lockResult.value };
}
