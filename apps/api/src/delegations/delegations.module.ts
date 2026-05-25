import { Module } from '@nestjs/common';
import { DbModule } from '@nest/db';
import { DelegationsController } from './delegations.controller';
import { ActorsModule } from '../actors/actors.module';

@Module({
  imports: [ActorsModule, DbModule],
  controllers: [DelegationsController],
  providers: [],
})
export class DelegationsModule {}
