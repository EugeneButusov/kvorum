import { Logger, Module } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
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
  AragonProposalRepository,
  AragonVotingArchivePayloadRepository,
  AragonProposalProjectionApplier,
  AragonVoteProjectionApplier,
  AragonVotingEventRepository,
  LidoAragonVotingActorAddressDeriver,
  LidoAragonVotingArchiveWriter,
  createLidoAragonVotingPlugin,
  createLidoAragonVotingReconcilePlugin,
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
      provide: LIDO_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: LidoAragonVotingArchiveWriter,
        dlqRepo: DlqRepository,
        archive: ArchiveDerivationRepository,
        proposals: ProposalRepository,
        voteRead: VoteEventsProjectionReadRepository,
        voteWrite: VoteEventsProjectionWriter,
        registry: ChainContextRegistry,
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

        return {
          name: 'lido',
          ingesters: [
            createLidoAragonVotingPlugin({
              archiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('LidoAragonVoting')),
            }),
            reconcilePlugin,
          ],
          derivers: [actorAddressDeriver, proposalApplier, voteApplier],
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
      ],
    },
  ],
  exports: [LIDO_SOURCE_PLUGIN],
})
export class LidoSourceModule {}
