import { Module } from '@nestjs/common';
import {
  ActorRepository,
  ActorRoutingReadRepository,
  pgDb,
  ProposalReadRepository,
  VoteReadRepository,
} from '@libs/db';
import { ActorProposalsController } from './actor-proposals.controller';
import { ActorRoutingService } from './actor-routing.service';
import { ActorVotesController } from './actor-votes.controller';
import { ActorsController } from './actors.controller';

@Module({
  providers: [
    { provide: ActorRepository, useFactory: () => new ActorRepository(pgDb) },
    { provide: ActorRoutingReadRepository, useFactory: () => new ActorRoutingReadRepository(pgDb) },
    { provide: ProposalReadRepository, useFactory: () => new ProposalReadRepository(pgDb) },
    { provide: VoteReadRepository, useFactory: () => new VoteReadRepository(pgDb) },
    ActorRoutingService,
  ],
  controllers: [ActorsController, ActorVotesController, ActorProposalsController],
  exports: [ActorRoutingService],
})
export class ActorsModule {}
