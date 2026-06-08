import type { Logger } from '@libs/chain';
import {
  ReconcileDriver,
  type ReconcileDriverConfig,
  type ReconcileDriverMetrics,
  type SourceIngester,
} from '@sources/core';
import { AavePayloadStateReconciler } from './aave-payload-state-reconciler';
import type { AavePayloadReconcileRepository } from '../../persistence/aave-payload-reconcile-repository';
import {
  AAVE_PAYLOADS_CONTROLLER_SUPPORTED_CHAIN_IDS,
  AavePayloadsControllerConfigSchema,
} from '../plugin/plugin';

export interface AavePayloadsControllerReconcilePluginDeps {
  proposals: AavePayloadReconcileRepository;
  metrics: ReconcileDriverMetrics;
  logger: Logger;
}

export function createAavePayloadsControllerReconcilePlugin(
  deps: AavePayloadsControllerReconcilePluginDeps,
): SourceIngester {
  const reconciler = new AavePayloadStateReconciler(deps.logger, ['aave_payloads_controller']);
  const config: ReconcileDriverConfig = {
    batchSize: Number(process.env['AAVE_STATE_RECONCILE_BATCH_SIZE'] ?? 50),
    rpcFailEscalateAfter: Number(process.env['AAVE_STATE_RECONCILE_RPC_FAIL_ESCALATE'] ?? 5),
  };
  const driver = new ReconcileDriver(reconciler, deps.proposals, deps.metrics, deps.logger, config);

  return {
    sourceType: 'aave_payloads_controller_reconcile',
    supportedChainIds: AAVE_PAYLOADS_CONTROLLER_SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => AavePayloadsControllerConfigSchema.parse(raw),
    buildIngestSpec: () => ({
      kind: 'evm-block-head-poller',
      listener: ({ chainCfg, headBlock, client }) => {
        const headLag = BigInt(chainCfg.headLag);
        if (headBlock < headLag) return;
        const blocksPerMinute = chainCfg.blocksPerMinute ?? 5;
        const recheckGapSeconds = Number(
          process.env['AAVE_STATE_RECONCILE_RECHECK_GAP_SECONDS'] ?? 7_200,
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
      throw new Error(
        'source_type "aave_payloads_controller_reconcile" does not support backfill runtime',
      );
    },
  };
}
