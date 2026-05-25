import { Module } from '@nestjs/common';
import { ProposalReadRepository, VoteReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';
import { VotesController } from './votes.controller';
import { ActorsModule } from '../actors/actors.module';

@Module({
  imports: [ActorsModule, DbModule.forFeature([VoteReadRepository, ProposalReadRepository])],
  controllers: [VotesController],
  providers: [],
})
export class VotesModule {}
