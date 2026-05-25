import { Module } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  AnalyticsClickHouseDatabase,
  AnalyticsReadRepository,
  chDb,
  DaoReadRepository,
  pgDb,
} from '@libs/db';

@Module({
  providers: [
    {
      provide: AnalyticsReadRepository,
      useFactory: () =>
        new AnalyticsReadRepository(chDb as unknown as Kysely<AnalyticsClickHouseDatabase>, pgDb),
    },
    { provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) },
  ],
  exports: [AnalyticsReadRepository, DaoReadRepository],
})
export class AnalyticsModule {}
