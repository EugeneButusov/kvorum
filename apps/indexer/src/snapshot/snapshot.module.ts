import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  DlqRepository,
  pgDb,
  ProposalRepository,
  VotingPowerSnapshotRepository,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
import { SOURCE_SNAPSHOT_STRATEGIES, type SourceSnapshotStrategies } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { SourcesModule } from '@nest/sources';
import { SnapshotWorkerService } from './snapshot-worker.service';
import { SNAPSHOT_STRATEGIES } from './snapshot.tokens';

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
      provide: SNAPSHOT_STRATEGIES,
      useFactory: (sourceStrategies: SourceSnapshotStrategies): SourceSnapshotStrategies =>
        new Map(sourceStrategies),
      inject: [SOURCE_SNAPSHOT_STRATEGIES],
    },
    SnapshotWorkerService,
  ],
  exports: [SnapshotWorkerService],
})
export class SnapshotModule {}
