import { Module } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  AnalyticsClickHouseDatabase,
  AnalyticsReadRepository,
  chDb,
  DaoReadRepository,
  pgDb,
} from '@libs/db';
import { ActorAnalyticsController } from './actor-analytics.controller';
import { DaoAnalyticsController } from './dao-analytics.controller';
import { ActorsModule } from '../actors/actors.module';
import { DaoModule } from '../daos/dao.module';

@Module({
  imports: [ActorsModule, DaoModule],
  providers: [
    {
      provide: AnalyticsReadRepository,
      useFactory: () =>
        new AnalyticsReadRepository(chDb as unknown as Kysely<AnalyticsClickHouseDatabase>, pgDb),
    },
    { provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) },
  ],
  controllers: [DaoAnalyticsController, ActorAnalyticsController],
})
export class AnalyticsModule {}
