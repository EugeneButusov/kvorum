import { Module } from '@nestjs/common';
import { ProposalReadRepository, VoteReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';

const VOTES_DB_MODULE = DbModule.forFeature([VoteReadRepository, ProposalReadRepository]);

@Module({
  imports: [VOTES_DB_MODULE],
  exports: [VOTES_DB_MODULE],
})
export class VotesModule {}
