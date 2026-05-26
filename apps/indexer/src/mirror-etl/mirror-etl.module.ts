import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  chDb,
  DlqRepository,
  MirrorEtlRunRepository,
  MirrorEtlWatermarkRepository,
  pgDb,
} from '@libs/db';
import { MirrorEtlService } from './mirror-etl.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    {
      provide: MirrorEtlWatermarkRepository,
      useFactory: () => new MirrorEtlWatermarkRepository(pgDb),
    },
    {
      provide: MirrorEtlRunRepository,
      useFactory: () => new MirrorEtlRunRepository(pgDb),
    },
    {
      provide: DlqRepository,
      useFactory: () => new DlqRepository(pgDb),
    },
    {
      provide: MirrorEtlService,
      useFactory: (
        watermarks: MirrorEtlWatermarkRepository,
        runs: MirrorEtlRunRepository,
        dlq: DlqRepository,
      ) =>
        new MirrorEtlService(pgDb, chDb, watermarks, runs, dlq, {
          batchSize: Number(process.env['MIRROR_ETL_BATCH_SIZE'] ?? '50000'),
          dlqThreshold: Number(process.env['MIRROR_ETL_DLQ_THRESHOLD'] ?? '3'),
          overlapHours: Number(process.env['MIRROR_ETL_OVERLAP_HOURS'] ?? '24'),
        }),
      inject: [MirrorEtlWatermarkRepository, MirrorEtlRunRepository, DlqRepository],
    },
  ],
  exports: [MirrorEtlService],
})
export class MirrorEtlModule {}
