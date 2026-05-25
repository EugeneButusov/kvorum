import { Module } from '@nestjs/common';
import { AnalyticsReadRepository, DaoReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';
import { ActorAnalyticsController } from './actor-analytics.controller';
import { DaoAnalyticsController } from './dao-analytics.controller';
import { ActorsModule } from '../actors/actors.module';
import { DaoModule } from '../daos/dao.module';

@Module({
  imports: [
    ActorsModule,
    DaoModule,
    DbModule.forFeature([AnalyticsReadRepository, DaoReadRepository]),
  ],
  controllers: [DaoAnalyticsController, ActorAnalyticsController],
  providers: [],
})
export class AnalyticsModule {}
