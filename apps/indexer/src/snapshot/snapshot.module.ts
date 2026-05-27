import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ActorRepository,
  DlqRepository,
  pgDb,
  ProposalRepository,
  chDb,
  VotingPowerSnapshotFlatWriter,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
import { SOURCE_PLUGINS, type SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { SourcesModule } from '@nest/sources';
import { SnapshotWorkerService } from './snapshot-worker.service';

@Module({
  imports: [ScheduleModule.forRoot(), ChainContextModule, SourcesModule],
  providers: [
    {
      provide: VotingPowerSnapshotFlatWriter,
      useFactory: () => new VotingPowerSnapshotFlatWriter(chDb),
    },
    {
      provide: ActorRepository,
      useFactory: () => new ActorRepository(pgDb),
    },
    {
      provide: ProposalRepository,
      useFactory: () => new ProposalRepository(pgDb),
    },
    {
      provide: VotingPowerSnapshotRunRepository,
      useFactory: () => new VotingPowerSnapshotRunRepository(pgDb),
    },
    {
      provide: DlqRepository,
      useFactory: () => new DlqRepository(pgDb),
    },
    {
      provide: SnapshotWorkerService,
      useFactory: (
        proposals: ProposalRepository,
        snapshots: VotingPowerSnapshotFlatWriter,
        actors: ActorRepository,
        runs: VotingPowerSnapshotRunRepository,
        dlq: DlqRepository,
        plugins: readonly SourcePlugin[],
      ) =>
        new SnapshotWorkerService(
          proposals,
          snapshots,
          actors,
          runs,
          dlq,
          SnapshotWorkerService.buildStrategies(plugins),
        ),
      inject: [
        ProposalRepository,
        VotingPowerSnapshotFlatWriter,
        ActorRepository,
        VotingPowerSnapshotRunRepository,
        DlqRepository,
        SOURCE_PLUGINS,
      ],
    },
  ],
  exports: [SnapshotWorkerService],
})
export class SnapshotModule {}
