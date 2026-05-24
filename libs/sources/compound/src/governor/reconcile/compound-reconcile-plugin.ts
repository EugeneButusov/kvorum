import type { Logger } from '@libs/chain';
import type { SourceIngester } from '@sources/core';
import type { ReconcileDriverMetrics } from './compound-reconcile-driver';
import { CompoundReconcileDriver } from './compound-reconcile-driver';
import { CompoundStateReconciler } from './compound-state-reconciler';
import type { CompoundProposalRepository } from '../persistence/compound-proposal-repository';
import { SUPPORTED_CHAIN_IDS, DaoSourceConfigSchema } from '../plugin/plugin';

export interface CompoundReconcilePluginDeps {
  proposals: CompoundProposalRepository;
  metrics: ReconcileDriverMetrics;
  logger: Logger;
}

function createReconcilePlugin(
  sourceType: string,
  targetSourceType: string,
  deps: CompoundReconcilePluginDeps,
): SourceIngester {
  const reconciler = new CompoundStateReconciler(deps.logger, [targetSourceType]);
  const driver = new CompoundReconcileDriver(reconciler, deps.proposals, deps.metrics, deps.logger);

  return {
    sourceType,
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => DaoSourceConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, _cfg) => ({
      kind: 'evm-block-head-poller',
      listener: ({ chainCfg, headBlock, client }) => {
        const headLag = BigInt(chainCfg.headLag);
        if (headBlock < headLag) return;
        const blocksPerMinute = chainCfg.blocksPerMinute ?? 5;
        const recheckGapSeconds = Number(
          process.env['COMPOUND_STATE_RECONCILE_RECHECK_GAP_SECONDS'] ?? 7_200,
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
      throw new Error(`source_type "${sourceType}" does not support backfill runtime`);
    },
  };
}

export function createCompoundGovernorBravoReconcilePlugin(
  deps: CompoundReconcilePluginDeps,
): SourceIngester {
  return createReconcilePlugin(
    'compound_governor_bravo_reconcile',
    'compound_governor_bravo',
    deps,
  );
}

export function createCompoundGovernorOzReconcilePlugin(
  deps: CompoundReconcilePluginDeps,
): SourceIngester {
  return createReconcilePlugin('compound_governor_oz_reconcile', 'compound_governor_oz', deps);
}
