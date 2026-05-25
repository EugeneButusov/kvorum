import { Module } from '@nestjs/common';
import { pgDb, ProposalReadRepository, VoteReadRepository } from '@libs/db';

@Module({
  providers: [
    { provide: VoteReadRepository, useFactory: () => new VoteReadRepository(pgDb) },
    { provide: ProposalReadRepository, useFactory: () => new ProposalReadRepository(pgDb) },
  ],
  exports: [VoteReadRepository, ProposalReadRepository],
})
export class VotesModule {}
