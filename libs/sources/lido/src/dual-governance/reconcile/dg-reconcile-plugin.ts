import type { Logger } from '@libs/chain';
import {
  ReconcileDriver,
  type ReconcileDriverConfig,
  type ReconcileDriverMetrics,
  type SourceIngester,
} from '@sources/core';
import { DualGovernanceStateReconciler } from './dg-state-reconciler';
import type { DualGovernanceReconcileRepository } from '../persistence/dg-reconcile-repository';
import { LidoDualGovernanceConfigSchema, SUPPORTED_CHAIN_IDS } from '../plugin/plugin';

export interface LidoDualGovernanceReconcilePluginDeps {
  /** Candidate source + watermark — the driver's stale-DAO supplier. */
  reconcile: DualGovernanceReconcileRepository;
  metrics: ReconcileDriverMetrics;
  logger: Logger;
}

/**
 * The `dual_governance_reconcile` ingester (ADR-0074 §2). An evm-block-head poller that reconciles
 * the DAO-wide DG state — observationally (drift surface) — at the confirmed threshold. Mirrors
 * `aragon_voting_reconcile`: the reconciler's `sourceTypes` is `['dual_governance']` (the source it
 * reconciles); the ingester's `sourceType` is `dual_governance_reconcile` (what the orchestrator
 * schedules, via the lido_008 dao_source binding).
 */
export function createLidoDualGovernanceReconcilePlugin(
  deps: LidoDualGovernanceReconcilePluginDeps,
): SourceIngester {
  const reconciler = new DualGovernanceStateReconciler(deps.logger, ['dual_governance']);
  const config: ReconcileDriverConfig = {
    batchSize: Number(process.env['LIDO_DG_RECONCILE_BATCH_SIZE'] ?? 10),
    rpcFailEscalateAfter: Number(process.env['LIDO_DG_RECONCILE_RPC_FAIL_ESCALATE'] ?? 5),
  };
  const driver = new ReconcileDriver(reconciler, deps.reconcile, deps.metrics, deps.logger, config);

  // No `backfillable` capability: a reconcile sweep re-queries live state, it has no eth_getLogs range
  // to backfill. `buildBackfillRuntime` is therefore omitted — the absent capability is what gates the
  // orchestrator + backfill planner, so no runtime is ever requested for this source.
  return {
    sourceType: 'dual_governance_reconcile',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    capabilities: [],
    parseConfig: (raw) => LidoDualGovernanceConfigSchema.parse(raw),
    buildIngestSpec: () => ({
      kind: 'evm-block-head-poller',
      listener: ({ chainCfg, headBlock, client }) => {
        const headLag = BigInt(chainCfg.headLag);
        if (headBlock < headLag) return;
        const blocksPerMinute = chainCfg.blocksPerMinute ?? 5;
        const recheckGapSeconds = Number(
          process.env['LIDO_DG_RECONCILE_RECHECK_GAP_SECONDS'] ?? 7_200,
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
