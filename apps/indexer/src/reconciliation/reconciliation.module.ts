import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  DaoSourceRepository,
  DlqRepository,
  ReconciliationWatermarkRepository,
  pgDb,
} from '@libs/db';
import { SOURCE_PLUGINS, type SourcePlugin } from '@sources/core';
import { SourcesModule } from '@nest/sources';
import { ChOrphanSweepService } from './ch-orphan-sweep.service';
import { PgOrphanSweepService } from './pg-orphan-sweep.service';

@Module({
  imports: [ScheduleModule.forRoot(), SourcesModule],
  providers: [
    {
      provide: DaoSourceRepository,
      useFactory: () => new DaoSourceRepository(pgDb),
    },
    {
      provide: ReconciliationWatermarkRepository,
      useFactory: () => new ReconciliationWatermarkRepository(pgDb),
    },
    {
      provide: DlqRepository,
      useFactory: () => new DlqRepository(pgDb),
    },
    {
      provide: 'RECONCILIATION_KNOWN_EVENT_TYPES',
      useFactory: (plugins: readonly SourcePlugin[]) => [
        ...new Set(
          plugins.flatMap((plugin) => plugin.derivers.flatMap((deriver) => deriver.eventTypes)),
        ),
      ],
      inject: [SOURCE_PLUGINS],
    },
    ChOrphanSweepService,
    PgOrphanSweepService,
  ],
  exports: [ChOrphanSweepService, PgOrphanSweepService],
})
export class ReconciliationModule {}
