import { Module } from '@nestjs/common';
import {
  ActorRepository,
  ActorRoutingReadRepository,
  ProposalReadRepository,
  VoteReadRepository,
  pgDb,
} from '@libs/db';
import { ActorProposalsController } from './actor-proposals.controller';
import { ActorRoutingService } from './actor-routing.service';
import { ActorVotesController } from './actor-votes.controller';
import { ActorsController } from './actors.controller';

@Module({
  controllers: [ActorsController, ActorVotesController, ActorProposalsController],
  providers: [
    ActorRoutingService,
    { provide: ActorRepository, useFactory: () => new ActorRepository(pgDb) },
    { provide: VoteReadRepository, useFactory: () => new VoteReadRepository(pgDb) },
    { provide: ProposalReadRepository, useFactory: () => new ProposalReadRepository(pgDb) },
    {
      provide: ActorRoutingReadRepository,
      useFactory: () => new ActorRoutingReadRepository(pgDb),
    },
  ],
  exports: [ActorRoutingService],
})
export class ActorsModule {}
