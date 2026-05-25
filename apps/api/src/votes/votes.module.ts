import { Module } from '@nestjs/common';
import { DbModule } from '@nest/db';
import { VotesController } from './votes.controller';
import { ActorsModule } from '../actors/actors.module';

@Module({
  imports: [ActorsModule, DbModule],
  controllers: [VotesController],
  providers: [],
})
export class VotesModule {}
