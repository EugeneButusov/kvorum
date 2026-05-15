import { Module } from '@nestjs/common';
import { DaoReadRepository, pgDb, ProposalReadRepository } from '@libs/db';
import { ProposalController } from './proposal.controller';

@Module({
  controllers: [ProposalController],
  providers: [
    {
      provide: ProposalReadRepository,
      useFactory: () => new ProposalReadRepository(pgDb),
    },
    {
      provide: DaoReadRepository,
      useFactory: () => new DaoReadRepository(pgDb),
    },
  ],
})
export class ProposalModule {}
