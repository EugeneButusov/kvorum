import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ChainContextRegistry } from '@libs/chain';
import {
  DlqRepository,
  pgDb,
  VotingPowerSnapshotRepository,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
import type { VotingPowerStrategy } from '@libs/domain';
import { CompoundCompTokenVotingPowerStrategy } from '@sources/compound';
import { ChainContextModule } from '@nest/chain';
import { SNAPSHOT_STRATEGIES, SnapshotWorkerService } from './snapshot-worker.service';

@Module({
  imports: [ScheduleModule.forRoot(), ChainContextModule],
  providers: [
    { provide: 'PG_DB', useValue: pgDb },
    {
      provide: VotingPowerSnapshotRepository,
      useFactory: () => new VotingPowerSnapshotRepository(pgDb),
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
      provide: CompoundCompTokenVotingPowerStrategy,
      useFactory: (registry: ChainContextRegistry) =>
        new CompoundCompTokenVotingPowerStrategy(pgDb, registry, '0x1'),
      inject: [ChainContextRegistry],
    },
    {
      provide: SNAPSHOT_STRATEGIES,
      useFactory: (
        strategy: CompoundCompTokenVotingPowerStrategy,
      ): Map<string, VotingPowerStrategy> =>
        new Map([
          ['compound_governor_alpha', strategy],
          ['compound_governor_bravo', strategy],
          ['compound_governor_oz', strategy],
        ]),
      inject: [CompoundCompTokenVotingPowerStrategy],
    },
    SnapshotWorkerService,
  ],
  exports: [SnapshotWorkerService],
})
export class SnapshotModule {}
