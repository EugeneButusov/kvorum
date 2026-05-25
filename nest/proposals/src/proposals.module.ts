import { Module } from '@nestjs/common';
import { DaoReadRepository, pgDb, ProposalReadRepository } from '@libs/db';

@Module({
  providers: [
    { provide: ProposalReadRepository, useFactory: () => new ProposalReadRepository(pgDb) },
    { provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) },
  ],
  exports: [ProposalReadRepository, DaoReadRepository],
})
export class ProposalModule {}
