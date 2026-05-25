import { Module } from '@nestjs/common';
import {
  ActorRepository,
  ActorRoutingReadRepository,
  ProposalReadRepository,
  VoteReadRepository,
} from '@libs/db';
import { DbModule } from '@nest/db';
import { ActorProposalsController } from './actor-proposals.controller';
import { ActorRoutingService } from './actor-routing.service';
import { ActorVotesController } from './actor-votes.controller';
import { ActorsController } from './actors.controller';

@Module({
  imports: [
    DbModule.forFeature([
      ActorRepository,
      ActorRoutingReadRepository,
      ProposalReadRepository,
      VoteReadRepository,
    ]),
  ],
  controllers: [ActorsController, ActorVotesController, ActorProposalsController],
  providers: [ActorRoutingService],
  exports: [ActorRoutingService],
})
export class ActorsModule {}
