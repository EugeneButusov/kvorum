import type { Logger } from '@libs/chain';
import {
  ReconcileDriver,
  type ReconcileDriverConfig,
  type ReconcileDriverMetrics,
  type SourceIngester,
} from '@sources/core';
import { AaveGovernorV2StateReconciler } from './aave-governor-v2-state-reconciler';
import type { AaveProposalRepository } from '../../persistence/aave-proposal-repository';
import { SUPPORTED_CHAIN_IDS, AaveGovernorV2ConfigSchema } from '../plugin/plugin';

export interface AaveGovernorV2ReconcilePluginDeps {
  proposals: AaveProposalRepository;
  metrics: ReconcileDriverMetrics;
  logger: Logger;
}

export function createAaveGovernorV2ReconcilePlugin(
  deps: AaveGovernorV2ReconcilePluginDeps,
): SourceIngester {
  const reconciler = new AaveGovernorV2StateReconciler(deps.logger, ['aave_governor_v2']);
  const config: ReconcileDriverConfig = {
    batchSize: Number(process.env['AAVE_V2_STATE_RECONCILE_BATCH_SIZE'] ?? 50),
    rpcFailEscalateAfter: Number(process.env['AAVE_V2_STATE_RECONCILE_RPC_FAIL_ESCALATE'] ?? 5),
  };
  const driver = new ReconcileDriver(reconciler, deps.proposals, deps.metrics, deps.logger, config);

  return {
    sourceType: 'aave_governor_v2_reconcile',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    capabilities: [],
    parseConfig: (raw) => AaveGovernorV2ConfigSchema.parse(raw),
    buildIngestSpec: () => ({
      kind: 'evm-block-head-poller',
      listener: ({ chainCfg, headBlock, client }) => {
        const headLag = BigInt(chainCfg.headLag);
        if (headBlock < headLag) return;
        const blocksPerMinute = chainCfg.blocksPerMinute ?? 5;
        const recheckGapSeconds = Number(
          process.env['AAVE_V2_STATE_RECONCILE_RECHECK_GAP_SECONDS'] ?? 7_200,
        );
        const recheckGapBlocks = Math.ceil((recheckGapSeconds / 60) * blocksPerMinute);
        void driver.onConfirmedHeads([
          {
            chainId: chainCfg.chainId,
            confirmedThresholdBlock: (headBlock - headLag).toString(),
            recheckGapBlocks,
            client,
          },
        ]);
      },
    }),
    buildBackfillRuntime: () => {
      throw new Error('source_type "aave_governor_v2_reconcile" does not support backfill runtime');
    },
  };
}
