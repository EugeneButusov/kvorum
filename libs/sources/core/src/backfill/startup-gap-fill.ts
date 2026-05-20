import { chainMetrics, type ChainConfig, type Logger, type RpcClient } from '@libs/chain';
import type { DaoSourceRepository } from '@libs/db';
import { BackfillDriver } from './backfill-driver';
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

export class StartupGapFillShutdownError extends Error {
  constructor() {
    super('startup gap fill cancelled by shutdown');
  }
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
    mode: 'catch-up',
    signal,
  });

  if (outcome.status === 'completed') {
    return { status: 'filled', fromBlock: outcome.fromBlock, toBlock: outcome.toBlock };
  }
  if (outcome.status === 'cancelled') {
    return { status: 'cancelled' };
  }
  return { status: 'error', error: outcome.error };
}

export async function processStartupGapFill(input: StartupGapFillInput): Promise<void> {
  const gapFillResult = await runStartupGapFill(input);
  const chain = input.chainConfig.name;
  const daoSource = input.daoSourceId;

  if (gapFillResult.status === 'skipped') {
    chainMetrics.ingestionGapFillSkipped.add(1, {
      chain,
      dao_source: daoSource,
      reason: gapFillResult.reason,
    });
    return;
  }

  if (gapFillResult.status === 'error') {
    chainMetrics.ingestionGapFillFailed.add(1, {
      chain,
      dao_source: daoSource,
      reason: 'error',
    });
    return;
  }

  if (gapFillResult.status === 'cancelled') {
    chainMetrics.ingestionGapFillFailed.add(1, {
      chain,
      dao_source: daoSource,
      reason: 'shutdown',
    });
    if (input.signal?.aborted) throw new StartupGapFillShutdownError();
  }
}
