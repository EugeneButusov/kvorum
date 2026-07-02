import { Logger, Module } from '@nestjs/common';
import {
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DlqRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
  chDb,
  pgDb,
} from '@libs/db';
import type { SourcePlugin } from '@sources/core';
import {
  DelegateRegistryActorAddressDeriver,
  DelegateRegistryArchivePayloadRepository,
  DelegateRegistryArchiveWriter,
  DelegateRegistryDelegationProjectionApplier,
  DelegateRegistryEventRepository,
  SNAPSHOT_DELEGATION_CHAIN_ID,
  SnapshotActorAddressDeriver,
  SnapshotArchivePayloadRepository,
  SnapshotClient,
  SnapshotDelegationRepository,
  SnapshotProposalProjectionApplier,
  SnapshotProposalRepository,
  SnapshotSpaceDaoResolver,
  SnapshotVoteChoiceRepository,
  SnapshotVoteProjectionApplier,
  SplitDelegationActorAddressDeriver,
  SplitDelegationArchivePayloadRepository,
  SplitDelegationArchiveWriter,
  SplitDelegationEventRepository,
  SplitDelegationProjectionApplier,
  createDelegateRegistryPlugin,
  createSnapshotPlugin,
  createSplitDelegationPlugin,
  makeSnapshotReadExtension,
  snapshotMetrics,
  type SnapshotDelegationProjectionMetrics,
  type SnapshotStaleProvider,
} from '@sources/snapshot';
import { toChainLogger } from '@nest/chain';

export const SNAPSHOT_SOURCE_PLUGIN = 'SNAPSHOT_SOURCE_PLUGIN';

// Reconcile re-queries up to this many stale closed proposals per space per poll tick.
const RECONCILE_BATCH = Number(process.env['SNAPSHOT_RECONCILE_BATCH'] ?? '25');

const delegationMetrics: SnapshotDelegationProjectionMetrics = {
  processed: ({ source_type, event_type, outcome, reason }) =>
    snapshotMetrics.delegationsDerived.add(1, {
      source_type,
      event_type,
      outcome,
      reason: reason ?? 'none',
    }),
};

// Off-chain source: one `snapshot` plugin covering all three seeded spaces (lido/aave/compound).
// Registers the proposal + vote projection appliers, the actor-address deriver, and the
// closed-proposal reconcile pass. Registering here starts live polling + derivation on boot
// (gated by INDEXER_LIVE_POLLER_ENABLED).
@Module({
  providers: [
    {
      provide: SNAPSHOT_SOURCE_PLUGIN,
      useFactory: (): SourcePlugin => {
        const intervalEnv = process.env['SNAPSHOT_POLL_INTERVAL_MS'];
        const client = new SnapshotClient({
          url: process.env['SNAPSHOT_GRAPHQL_URL'],
          apiKey: process.env['SNAPSHOT_API_KEY'],
        });
        const payloads = new SnapshotArchivePayloadRepository(chDb);

        const proposalApplier = new SnapshotProposalProjectionApplier({
          pgDb,
          payloads,
          archive: new ArchiveDerivationRepository(pgDb),
          logger: toChainLogger(new Logger('SnapshotProposalProjection')),
        });
        const actorAddressDeriver = new SnapshotActorAddressDeriver(payloads);

        const voteApplier = new SnapshotVoteProjectionApplier({
          payloads,
          proposals: new ProposalRepository(pgDb),
          snapshotProposals: new SnapshotProposalRepository(pgDb),
          voteRead: new VoteEventsProjectionReadRepository(chDb),
          voteWrite: new VoteEventsProjectionWriter(chDb),
          voteChoice: new SnapshotVoteChoiceRepository(chDb),
          archive: new ArchiveDerivationRepository(pgDb),
          logger: toChainLogger(new Logger('SnapshotVoteProjection')),
        });

        // Per-space reconcile stale-provider, backed by the proposal/metadata tables. The signal is
        // threaded to the HTTP re-query in the listener; the PG read is bounded + indexed.
        const staleProviderFactory =
          (space: string): SnapshotStaleProvider =>
          () =>
            new SnapshotProposalRepository(pgDb).findStaleClosedProposalIds(space, RECONCILE_BATCH);

        // On-chain delegation (mainnet): shared PG target + space→dao resolver, then one ingester
        // and (actor + projection) deriver pair per delegation system. dao attribution is recovered
        // from the decoded space, not the trigger-owner dao_source (see ADR-0075).
        const archiveEventRepo = new ArchiveEventRepository(pgDb);
        const dlqRepo = new DlqRepository(pgDb);
        const archive = new ArchiveDerivationRepository(pgDb);
        const delegationRepo = new SnapshotDelegationRepository(pgDb);
        const spaceResolver = new SnapshotSpaceDaoResolver(pgDb);

        const delegateRegistryPayloads = new DelegateRegistryArchivePayloadRepository(chDb);
        const delegateRegistryWriter = new DelegateRegistryArchiveWriter({
          eventRepo: new DelegateRegistryEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('DelegateRegistryArchiveWriter')),
        });
        const delegateRegistryApplier = new DelegateRegistryDelegationProjectionApplier({
          archive,
          dlq: dlqRepo,
          payloads: delegateRegistryPayloads,
          delegationRepo,
          spaceResolver,
          metrics: delegationMetrics,
          network: SNAPSHOT_DELEGATION_CHAIN_ID,
          logger: toChainLogger(new Logger('DelegateRegistryProjection')),
        });
        const delegateRegistryActorDeriver = new DelegateRegistryActorAddressDeriver(
          delegateRegistryPayloads,
        );

        const splitDelegationPayloads = new SplitDelegationArchivePayloadRepository(chDb);
        const splitDelegationWriter = new SplitDelegationArchiveWriter({
          eventRepo: new SplitDelegationEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('SplitDelegationArchiveWriter')),
        });
        const splitDelegationApplier = new SplitDelegationProjectionApplier({
          archive,
          dlq: dlqRepo,
          payloads: splitDelegationPayloads,
          delegationRepo,
          spaceResolver,
          metrics: delegationMetrics,
          network: SNAPSHOT_DELEGATION_CHAIN_ID,
          logger: toChainLogger(new Logger('SplitDelegationProjection')),
        });
        const splitDelegationActorDeriver = new SplitDelegationActorAddressDeriver(
          splitDelegationPayloads,
        );

        return {
          name: 'snapshot',
          ingesters: [
            createSnapshotPlugin({
              client,
              chDb,
              intervalMs: intervalEnv ? Number(intervalEnv) : undefined,
              staleProviderFactory,
            }),
            createDelegateRegistryPlugin({
              archiveWriter: delegateRegistryWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('DelegateRegistry')),
            }),
            createSplitDelegationPlugin({
              archiveWriter: splitDelegationWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('SplitDelegation')),
            }),
          ],
          derivers: [
            proposalApplier,
            actorAddressDeriver,
            voteApplier,
            delegateRegistryApplier,
            delegateRegistryActorDeriver,
            splitDelegationApplier,
            splitDelegationActorDeriver,
          ],
          readExtension: makeSnapshotReadExtension(pgDb),
        };
      },
    },
  ],
  exports: [SNAPSHOT_SOURCE_PLUGIN],
})
export class SnapshotSourceModule {}
