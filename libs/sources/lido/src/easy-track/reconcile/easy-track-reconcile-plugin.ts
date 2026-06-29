import type { Logger } from '@libs/chain';
import {
  ReconcileDriver,
  type ReconcileDriverConfig,
  type ReconcileDriverMetrics,
  type SourceIngester,
} from '@sources/core';
import { EasyTrackStateReconciler } from './easy-track-state-reconciler';
import type { EasyTrackReconcileRepository } from '../persistence/reconcile-repository';
import { LidoEasyTrackConfigSchema, SUPPORTED_CHAIN_IDS } from '../plugin/plugin';

export interface LidoEasyTrackReconcilePluginDeps {
  /** Reconcile repo — the driver's stale-candidate source + the guarded `active → queued` write. */
  easyTrackProposals: EasyTrackReconcileRepository;
  metrics: ReconcileDriverMetrics;
  logger: Logger;
}

export function createLidoEasyTrackReconcilePlugin(
  deps: LidoEasyTrackReconcilePluginDeps,
): SourceIngester {
  // Reconcile the proposals owned by the base `easy_track` source_type.
  const reconciler = new EasyTrackStateReconciler(deps.logger, ['easy_track']);
  const config: ReconcileDriverConfig = {
    batchSize: Number(process.env['LIDO_STATE_RECONCILE_BATCH_SIZE'] ?? 50),
    rpcFailEscalateAfter: Number(process.env['LIDO_STATE_RECONCILE_RPC_FAIL_ESCALATE'] ?? 5),
  };
  const driver = new ReconcileDriver(
    reconciler,
    deps.easyTrackProposals,
    deps.metrics,
    deps.logger,
    config,
  );

  return {
    sourceType: 'easy_track_reconcile',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => LidoEasyTrackConfigSchema.parse(raw),
    // No buildBackfillRuntime — reconcilers are head-driven only, never backfilled.
    buildIngestSpec: () => ({
      kind: 'evm-block-head-poller',
      listener: ({ chainCfg, headBlock, client }) => {
        const headLag = BigInt(chainCfg.headLag);
        if (headBlock < headLag) return;
        const blocksPerMinute = chainCfg.blocksPerMinute ?? 5;
        const recheckGapSeconds = Number(
          process.env['LIDO_STATE_RECONCILE_RECHECK_GAP_SECONDS'] ?? 7_200,
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
  };
}
