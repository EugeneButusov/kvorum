import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  DlqRepository,
  pgDb,
  ProposalRepository,
  VotingPowerSnapshotRepository,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
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
    SnapshotWorkerService,
  ],
  exports: [SnapshotWorkerService],
})
export class SnapshotModule {}
