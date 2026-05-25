import { Module } from '@nestjs/common';
import { DaoReadRepository, DelegationReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';
import { DelegationsController } from './delegations.controller';
import { ActorsModule } from '../actors/actors.module';

@Module({
  imports: [ActorsModule, DbModule.forFeature([DelegationReadRepository, DaoReadRepository])],
  controllers: [DelegationsController],
  providers: [],
})
export class DelegationsModule {}
