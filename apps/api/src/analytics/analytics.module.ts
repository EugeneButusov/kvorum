import { Module } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { chDb, pgDb } from '@libs/db';
import { ActorAnalyticsController } from './actor-analytics.controller';
import {
  AnalyticsReadRepository,
  type AnalyticsClickHouseDatabase,
} from './analytics-read-repository';
import { DaoAnalyticsController } from './dao-analytics.controller';
import { ActorsModule } from '../actors/actors.module';
import { DaoModule } from '../daos/dao.module';

@Module({
  imports: [ActorsModule, DaoModule],
  controllers: [DaoAnalyticsController, ActorAnalyticsController],
  providers: [
    {
      provide: AnalyticsReadRepository,
      useFactory: () =>
        new AnalyticsReadRepository(chDb as unknown as Kysely<AnalyticsClickHouseDatabase>, pgDb),
    },
  ],
})
export class AnalyticsModule {}
