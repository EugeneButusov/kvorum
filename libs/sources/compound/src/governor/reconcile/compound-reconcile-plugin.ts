import type { Logger } from '@libs/chain';
import type { SourcePlugin } from '@sources/core';
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
): SourcePlugin {
  const reconciler = new CompoundStateReconciler(deps.logger, [targetSourceType]);
  const driver = new CompoundReconcileDriver(reconciler, deps.proposals, deps.metrics, deps.logger);

  return {
    sourceType,
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => DaoSourceConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, _cfg) => ({
      kind: 'evm-block-head-poller',
      recheckGapSeconds: Number(
        process.env['COMPOUND_STATE_RECONCILE_RECHECK_GAP_SECONDS'] ?? 7_200,
      ),
      listener: (args) => {
        void driver.onConfirmedHeads([
          {
            chainId: args.chainId,
            confirmedThresholdBlock: args.confirmedThresholdBlock.toString(),
            recheckGapBlocks: args.recheckGapBlocks,
            client: args.client,
          },
        ]);
      },
    }),
  };
}

export function createCompoundGovernorBravoReconcilePlugin(
  deps: CompoundReconcilePluginDeps,
): SourcePlugin {
  return createReconcilePlugin(
    'compound_governor_bravo_reconcile',
    'compound_governor_bravo',
    deps,
  );
}

export function createCompoundGovernorOzReconcilePlugin(
  deps: CompoundReconcilePluginDeps,
): SourcePlugin {
  return createReconcilePlugin('compound_governor_oz_reconcile', 'compound_governor_oz', deps);
}
