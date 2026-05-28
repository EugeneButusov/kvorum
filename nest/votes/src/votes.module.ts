import { Module } from '@nestjs/common';
import { ProposalReadRepository, VoteReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';

// TODO(tech-debt): replace this dynamic-module re-export pattern with explicit
// repository provider wiring once the shared db module API is cleaned up.
const VOTES_DB_MODULE = DbModule.forFeature([VoteReadRepository, ProposalReadRepository]);

@Module({
  imports: [VOTES_DB_MODULE],
  exports: [VOTES_DB_MODULE],
})
export class VotesModule {}
