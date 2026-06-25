import { Logger, Module } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DaoSourceRepository,
  DlqRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
  chDb,
  pgDb,
} from '@libs/db';
import type { SourcePlugin } from '@sources/core';
import {
  AragonProposalRepository,
  AragonVotingArchivePayloadRepository,
  AragonProposalProjectionApplier,
  AragonVoteProjectionApplier,
  AragonVotingEventRepository,
  AragonEnactmentLookup,
  DualGovernanceArchivePayloadRepository,
  DualGovernanceEventRepository,
  DualGovernanceProposalProjectionApplier,
  DualGovernanceProposalRepository,
  DualGovernanceStateHistoryRepository,
  DualGovernanceStateProjectionApplier,
  LidoAragonVotingActorAddressDeriver,
  LidoDualGovernanceActorAddressDeriver,
  LidoAragonVotingArchiveWriter,
  LidoDualGovernanceArchiveWriter,
  createLidoAragonVotingPlugin,
  createLidoAragonVotingReconcilePlugin,
  createLidoDualGovernancePlugin,
  makeLidoReadExtension,
} from '@sources/lido';
import { ChainContextModule, toChainLogger } from '@nest/chain';
import { DbModule } from '@nest/db';
import { buildDriverMetrics } from '../../reconcile-metrics';

export const LIDO_SOURCE_PLUGIN = 'LIDO_SOURCE_PLUGIN';

const NOOP_PROJECTION_METRICS = {
  batchLookupSeconds: () => undefined,
  chWriteSeconds: () => undefined,
  processed: () => undefined,
};

@Module({
  imports: [
    ChainContextModule,
    DbModule.forFeature([
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
      provide: LidoAragonVotingArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) =>
        new LidoAragonVotingArchiveWriter({
          eventRepo: new AragonVotingEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('LidoAragonVotingArchiveWriter')),
        }),
      inject: [ArchiveEventRepository, DlqRepository],
    },
    {
      provide: LidoDualGovernanceArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) =>
        new LidoDualGovernanceArchiveWriter({
          eventRepo: new DualGovernanceEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('LidoDualGovernanceArchiveWriter')),
        }),
      inject: [ArchiveEventRepository, DlqRepository],
    },
    {
      provide: LIDO_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: LidoAragonVotingArchiveWriter,
        dlqRepo: DlqRepository,
        archive: ArchiveDerivationRepository,
        proposals: ProposalRepository,
        voteRead: VoteEventsProjectionReadRepository,
        voteWrite: VoteEventsProjectionWriter,
        registry: ChainContextRegistry,
        dgArchiveWriter: LidoDualGovernanceArchiveWriter,
        daoSources: DaoSourceRepository,
      ): SourcePlugin => {
        const payloads = new AragonVotingArchivePayloadRepository(chDb);
        const actorAddressDeriver = new LidoAragonVotingActorAddressDeriver(payloads);
        const proposalApplier = new AragonProposalProjectionApplier({
          pgDb,
          archive,
          dlq: dlqRepo,
          payloads,
          metrics: NOOP_PROJECTION_METRICS,
          logger: toChainLogger(new Logger('AragonProposalProjectionApplier')),
        });
        const voteApplier = new AragonVoteProjectionApplier({
          archive,
          dlq: dlqRepo,
          payloads,
          proposals,
          voteRead,
          voteWrite,
          registry,
          metrics: NOOP_PROJECTION_METRICS,
          logger: toChainLogger(new Logger('AragonVoteProjectionApplier')),
        });

        const reconcilePlugin = createLidoAragonVotingReconcilePlugin({
          aragonProposals: new AragonProposalRepository(pgDb),
          proposals,
          metrics: buildDriverMetrics(),
          logger: toChainLogger(new Logger('AragonVotingReconcile')),
        });

        const dgPayloads = new DualGovernanceArchivePayloadRepository(chDb);
        const dgActorAddressDeriver = new LidoDualGovernanceActorAddressDeriver(dgPayloads);
        const dgStateApplier = new DualGovernanceStateProjectionApplier({
          archive,
          dlq: dlqRepo,
          payloads: dgPayloads,
          daoSources,
          history: new DualGovernanceStateHistoryRepository(pgDb),
          metrics: NOOP_PROJECTION_METRICS,
          logger: toChainLogger(new Logger('DualGovernanceStateProjection')),
        });
        const dgProposalApplier = new DualGovernanceProposalProjectionApplier({
          archive,
          dlq: dlqRepo,
          payloads: dgPayloads,
          proposals,
          actors: new ActorRepository(pgDb),
          ledger: new DualGovernanceProposalRepository(pgDb),
          enactment: new AragonEnactmentLookup(chDb),
          metrics: NOOP_PROJECTION_METRICS,
          logger: toChainLogger(new Logger('DualGovernanceProposalProjection')),
        });

        return {
          name: 'lido',
          ingesters: [
            createLidoAragonVotingPlugin({
              archiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('LidoAragonVoting')),
            }),
            createLidoDualGovernancePlugin({
              archiveWriter: dgArchiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('LidoDualGovernance')),
            }),
            reconcilePlugin,
          ],
          derivers: [
            actorAddressDeriver,
            proposalApplier,
            voteApplier,
            dgActorAddressDeriver,
            dgStateApplier,
            dgProposalApplier,
          ],
          readExtension: makeLidoReadExtension(),
        };
      },
      inject: [
        LidoAragonVotingArchiveWriter,
        DlqRepository,
        ArchiveDerivationRepository,
        ProposalRepository,
        VoteEventsProjectionReadRepository,
        VoteEventsProjectionWriter,
        ChainContextRegistry,
        LidoDualGovernanceArchiveWriter,
        DaoSourceRepository,
      ],
    },
  ],
  exports: [LIDO_SOURCE_PLUGIN],
})
export class LidoSourceModule {}
