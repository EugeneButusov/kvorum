import { Module, Logger } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import {
  ActorRepository,
  ArchiveEventRepository,
  ArchiveDerivationRepository,
  DaoSourceRepository,
  DlqRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
  chDb,
  pgDb,
} from '@libs/db';
import {
  COMPOUND_ACTOR_SWEEP_EXTRACTOR,
  CompoundCompTokenVotingPowerStrategy,
  CompTokenDelegationSnapshotRepository,
  CompTokenArchiveWriter,
  CompTokenArchivePayloadRepository,
  CompTokenEventRepository,
  CompTokenDelegationProjectionApplier,
  CompoundProposalRepository,
  GovernorArchivePayloadRepository,
  GovernorArchiveWriter,
  GovernorEventRepository,
  GovernorProjectionApplier,
  GovernorVoteProjectionApplier,
  createCompTokenPlugin,
  createCompoundGovernorBravoReconcilePlugin,
  createCompoundGovernorOzReconcilePlugin,
  createCompoundPlugins,
} from '@sources/compound';
import type { SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { toChainLogger } from '@nest/chain';
import { DbModule } from '@nest/db';
import { buildDriverMetrics } from '../../reconcile-metrics';

export const COMPOUND_SOURCE_PLUGIN = 'COMPOUND_SOURCE_PLUGIN';

@Module({
  imports: [
    ChainContextModule,
    DbModule.forFeature([
      ActorRepository,
      ArchiveDerivationRepository,
      ArchiveEventRepository,
      DaoSourceRepository,
      DlqRepository,
      ProposalRepository,
      VoteEventsProjectionReadRepository,
      VoteEventsProjectionWriter,
    ]),
  ],
  providers: [
    {
      provide: GovernorArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) => {
        const eventRepo = new GovernorEventRepository({ chDb });
        return new GovernorArchiveWriter({
          eventRepo,
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('GovernorArchiveWriter')),
        });
      },
      inject: [ArchiveEventRepository, DlqRepository],
    },
    {
      provide: CompoundProposalRepository,
      useFactory: () => new CompoundProposalRepository(pgDb),
    },
    {
      provide: CompTokenEventRepository,
      useFactory: () => new CompTokenEventRepository({ chDb }),
    },
    {
      provide: CompTokenArchiveWriter,
      useFactory: (
        eventRepo: CompTokenEventRepository,
        archiveEventRepo: ArchiveEventRepository,
        dlqRepo: DlqRepository,
      ) =>
        new CompTokenArchiveWriter({
          eventRepo,
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('CompTokenArchiveWriter')),
        }),
      inject: [CompTokenEventRepository, ArchiveEventRepository, DlqRepository],
    },
    {
      provide: GovernorProjectionApplier,
      useFactory: (archive: ArchiveDerivationRepository) =>
        new GovernorProjectionApplier({
          pgDb,
          chDb,
          archive,
          payloads: new GovernorArchivePayloadRepository(chDb),
          metrics: {
            batchLookupSeconds: () => undefined,
            processed: () => undefined,
          },
          logger: toChainLogger(new Logger('GovernorProjectionApplier')),
        }),
      inject: [ArchiveDerivationRepository],
    },
    {
      provide: GovernorVoteProjectionApplier,
      useFactory: (
        archive: ArchiveDerivationRepository,
        dlq: DlqRepository,
        proposals: ProposalRepository,
        voteRead: VoteEventsProjectionReadRepository,
        voteWrite: VoteEventsProjectionWriter,
        registry: ChainContextRegistry,
      ) =>
        new GovernorVoteProjectionApplier({
          archive,
          dlq,
          payloads: new GovernorArchivePayloadRepository(chDb),
          proposals,
          voteRead,
          voteWrite,
          registry,
          metrics: {
            batchLookupSeconds: () => undefined,
            chWriteSeconds: () => undefined,
            processed: () => undefined,
          },
          logger: toChainLogger(new Logger('GovernorVoteProjectionApplier')),
        }),
      inject: [
        ArchiveDerivationRepository,
        DlqRepository,
        ProposalRepository,
        VoteEventsProjectionReadRepository,
        VoteEventsProjectionWriter,
        ChainContextRegistry,
      ],
    },
    {
      provide: CompTokenDelegationProjectionApplier,
      useFactory: (archive: ArchiveDerivationRepository, dlq: DlqRepository) =>
        new CompTokenDelegationProjectionApplier({
          pgDb,
          chDb,
          archive,
          dlq,
          payloads: new CompTokenArchivePayloadRepository(chDb),
          metrics: {
            batchLookupSeconds: () => undefined,
            chWriteSeconds: () => undefined,
            processed: () => undefined,
          },
          logger: toChainLogger(new Logger('CompTokenDelegationProjectionApplier')),
        }),
      inject: [ArchiveDerivationRepository, DlqRepository],
    },
    {
      provide: CompTokenDelegationSnapshotRepository,
      useFactory: () => new CompTokenDelegationSnapshotRepository(chDb),
    },
    {
      provide: COMPOUND_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: GovernorArchiveWriter,
        dlqRepo: DlqRepository,
        proposalRepo: CompoundProposalRepository,
        compTokenArchiveWriter: CompTokenArchiveWriter,
        projectionApplier: GovernorProjectionApplier,
        voteProjectionApplier: GovernorVoteProjectionApplier,
        delegationProjectionApplier: CompTokenDelegationProjectionApplier,
        delegationSnapshotRepo: CompTokenDelegationSnapshotRepository,
        actorRepo: ActorRepository,
      ): SourcePlugin => {
        const governorPayloads = new GovernorArchivePayloadRepository(chDb);
        const compTokenPayloads = new CompTokenArchivePayloadRepository(chDb);
        const reconcileLogger = toChainLogger(new Logger('CompoundReconcile'));
        const metrics = buildDriverMetrics();
        const logger = new Logger('CompoundSourceModule');
        logger.log('compound_comp_token plugin registered');
        const snapshotStrategy = new CompoundCompTokenVotingPowerStrategy(
          delegationSnapshotRepo,
          actorRepo,
        );

        return {
          name: 'compound',
          ingesters: [
            ...createCompoundPlugins({
              archiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('CompoundGovernor')),
            }),
            createCompTokenPlugin({
              archiveWriter: compTokenArchiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('CompTokenIngester')),
            }),
            createCompoundGovernorBravoReconcilePlugin({
              proposals: proposalRepo,
              metrics,
              logger: reconcileLogger,
            }),
            createCompoundGovernorOzReconcilePlugin({
              proposals: proposalRepo,
              metrics,
              logger: reconcileLogger,
            }),
          ],
          derivers: [
            projectionApplier,
            voteProjectionApplier,
            delegationProjectionApplier,
            {
              kind: 'actor-address',
              sourceTypes: COMPOUND_ACTOR_SWEEP_EXTRACTOR.sourceTypes,
              eventTypes: COMPOUND_ACTOR_SWEEP_EXTRACTOR.eventTypes,
              fetchPayloads: async (rows) => {
                if (rows.length === 0) return [];
                const sourceType = rows[0]!.source_type;
                if (
                  sourceType === 'compound_governor_alpha' ||
                  sourceType === 'compound_governor_bravo' ||
                  sourceType === 'compound_governor_oz'
                ) {
                  return governorPayloads.fetchPayloads(rows);
                }
                if (sourceType === 'compound_comp_token') {
                  return compTokenPayloads.fetchPayloads(rows);
                }
                throw new Error(`unsupported source_type for actor sweep: ${sourceType}`);
              },
              extractAddresses: COMPOUND_ACTOR_SWEEP_EXTRACTOR.extractAddresses,
            },
          ],
          snapshotStrategies: [
            {
              sourceTypes: [
                'compound_governor_alpha',
                'compound_governor_bravo',
                'compound_governor_oz',
              ],
              strategy: snapshotStrategy,
            },
          ],
        };
      },
      inject: [
        GovernorArchiveWriter,
        DlqRepository,
        CompoundProposalRepository,
        CompTokenArchiveWriter,
        GovernorProjectionApplier,
        GovernorVoteProjectionApplier,
        CompTokenDelegationProjectionApplier,
        CompTokenDelegationSnapshotRepository,
        ActorRepository,
      ],
    },
  ],
  exports: [COMPOUND_SOURCE_PLUGIN],
})
export class CompoundSourceModule {}
