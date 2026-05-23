import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  DlqRepository,
  pgDb,
  ProposalRepository,
  VotingPowerSnapshotRepository,
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
      provide: VotingPowerSnapshotRepository,
      useFactory: () => new VotingPowerSnapshotRepository(pgDb),
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
        snapshots: VotingPowerSnapshotRepository,
        runs: VotingPowerSnapshotRunRepository,
        dlq: DlqRepository,
        plugins: readonly SourcePlugin[],
      ) =>
        new SnapshotWorkerService(
          proposals,
          snapshots,
          runs,
          dlq,
          SnapshotWorkerService.buildStrategies(plugins),
        ),
      inject: [
        ProposalRepository,
        VotingPowerSnapshotRepository,
        VotingPowerSnapshotRunRepository,
        DlqRepository,
        SOURCE_PLUGINS,
      ],
    },
  ],
  exports: [SnapshotWorkerService],
})
export class SnapshotModule {}
