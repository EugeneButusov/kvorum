import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ActorRepository,
  DlqRepository,
  ProposalRepository,
  VotingPowerSnapshotProjectionWriter,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
import { SOURCE_PLUGINS, type SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { DbModule } from '@nest/db';
import { SourcesModule } from '@nest/sources';
import { SnapshotWorkerService } from './snapshot-worker.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ChainContextModule,
    SourcesModule,
    DbModule.forFeature([
      VotingPowerSnapshotProjectionWriter,
      ActorRepository,
      ProposalRepository,
      VotingPowerSnapshotRunRepository,
      DlqRepository,
    ]),
  ],
  providers: [
    {
      provide: SnapshotWorkerService,
      useFactory: (
        proposals: ProposalRepository,
        snapshots: VotingPowerSnapshotProjectionWriter,
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
        VotingPowerSnapshotProjectionWriter,
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
