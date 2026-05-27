import { Module } from '@nestjs/common';
import { chDb, pgDb, ProposalReadRepository, VoteReadRepository } from '@libs/db';

@Module({
  providers: [
    { provide: VoteReadRepository, useFactory: () => new VoteReadRepository(pgDb, chDb as never) },
    { provide: ProposalReadRepository, useFactory: () => new ProposalReadRepository(pgDb) },
  ],
  exports: [VoteReadRepository, ProposalReadRepository],
})
export class VotesModule {}
