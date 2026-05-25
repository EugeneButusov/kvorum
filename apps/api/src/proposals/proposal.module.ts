import { Module } from '@nestjs/common';
import { DaoReadRepository, pgDb, ProposalReadRepository } from '@libs/db';
import { ProposalController } from './proposal.controller';

@Module({
  providers: [
    { provide: ProposalReadRepository, useFactory: () => new ProposalReadRepository(pgDb) },
    { provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) },
  ],
  controllers: [ProposalController],
})
export class ProposalModule {}
