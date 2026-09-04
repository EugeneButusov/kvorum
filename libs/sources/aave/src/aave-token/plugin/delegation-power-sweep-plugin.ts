import type { Logger } from '@libs/chain';
import type {
  DaoSourceRepository,
  DelegateDiscoveryRepository,
  NewDelegationFlowProjectionRow,
} from '@libs/db';
import type { SourceIngester } from '@sources/core';
import {
  AaveTokenConfigSchema,
  AAVE_TOKEN_SUPPORTED_CHAIN_IDS,
  type AaveTokenConfig,
} from './plugin';
import { AAVE_TOKEN_ADDRESS } from '../constants';
import { DelegationPowerSweepDriver } from '../domain/delegation-power-sweep-driver';

export interface DelegationPowerSweepPluginDeps {
  discovery: DelegateDiscoveryRepository;
  writer: { insertBatch(rows: readonly NewDelegationFlowProjectionRow[]): Promise<void> };
  daoIdResolver: DaoSourceRepository;
  logger: Logger;
}

export function createAaveDelegationPowerSweepPlugin(
  deps: DelegationPowerSweepPluginDeps,
): SourceIngester<AaveTokenConfig> {
  const driver = new DelegationPowerSweepDriver(
    {
      discovery: deps.discovery,
      writer: deps.writer,
      daoIdResolver: deps.daoIdResolver,
      logger: deps.logger,
    },
    {
      tokenAddress: AAVE_TOKEN_ADDRESS,
      sweepCooldownBlocks: Number(process.env['AAVE_DELEGATION_SWEEP_COOLDOWN_BLOCKS'] ?? 450),
      batchSize: Number(process.env['AAVE_DELEGATION_SWEEP_BATCH_SIZE'] ?? 50),
    },
  );

  return {
    sourceType: 'aave_token_delegation_sweep',
    supportedChainIds: AAVE_TOKEN_SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => AaveTokenConfigSchema.parse(raw),
    buildIngestSpec: (ctx) => ({
      kind: 'evm-block-head-poller',
      listener: ({ chainCfg, headBlock, client }) => {
        const headLag = BigInt(chainCfg.headLag);
        if (headBlock < headLag) return;
        const confirmedBlock = headBlock - headLag;
        void driver.onConfirmedHead({
          confirmedBlock,
          blockTag: `0x${confirmedBlock.toString(16)}`,
          client,
          daoSourceId: ctx.daoSourceId,
        });
      },
    }),
  };
}
