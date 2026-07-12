import { Module } from '@nestjs/common';
import {
  chDb,
  DaoReadRepository,
  pgDb,
  ProposalReadRepository,
  VoteReadRepository,
} from '@libs/db';

@Module({
  providers: [
    { provide: ProposalReadRepository, useFactory: () => new ProposalReadRepository(pgDb) },
    { provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) },
    // The tally endpoint aggregates the current votes for a proposal (ClickHouse).
    { provide: VoteReadRepository, useFactory: () => new VoteReadRepository(pgDb, chDb) },
  ],
  exports: [ProposalReadRepository, DaoReadRepository, VoteReadRepository],
})
export class ProposalModule {}
