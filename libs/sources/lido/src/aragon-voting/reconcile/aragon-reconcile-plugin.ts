import type { Logger } from '@libs/chain';
import { ProposalRepository } from '@libs/db';
import {
  ReconcileDriver,
  type ReconcileDriverConfig,
  type ReconcileDriverMetrics,
  type SourceIngester,
} from '@sources/core';
import { AragonStateReconciler } from './aragon-state-reconciler';
import type { AragonProposalRepository } from '../persistence/aragon-proposal-repository';
import { LidoAragonVotingConfigSchema, SUPPORTED_CHAIN_IDS } from '../plugin/plugin';

export interface LidoAragonVotingReconcilePluginDeps {
  /** Reconcile/enrich repo — the driver's stale-candidate source. */
  aragonProposals: AragonProposalRepository;
  /** Shared proposal repo — the reconciler inserts proposal_action rows through it. */
  proposals: ProposalRepository;
  metrics: ReconcileDriverMetrics;
  logger: Logger;
}

export function createLidoAragonVotingReconcilePlugin(
  deps: LidoAragonVotingReconcilePluginDeps,
): SourceIngester {
  // Reconcile the proposals owned by the base `aragon_voting` source_type.
  const reconciler = new AragonStateReconciler(deps.logger, ['aragon_voting'], deps.proposals);
  const config: ReconcileDriverConfig = {
    batchSize: Number(process.env['LIDO_STATE_RECONCILE_BATCH_SIZE'] ?? 50),
    rpcFailEscalateAfter: Number(process.env['LIDO_STATE_RECONCILE_RPC_FAIL_ESCALATE'] ?? 5),
  };
  const driver = new ReconcileDriver(
    reconciler,
    deps.aragonProposals,
    deps.metrics,
    deps.logger,
    config,
  );

  return {
    sourceType: 'aragon_voting_reconcile',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    capabilities: [],
    parseConfig: (raw) => LidoAragonVotingConfigSchema.parse(raw),
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
    buildBackfillRuntime: () => {
      throw new Error('source_type "aragon_voting_reconcile" does not support backfill runtime');
    },
  };
}
