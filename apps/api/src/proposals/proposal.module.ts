import { Module } from '@nestjs/common';
import { DaoReadRepository, ProposalReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';
import { ProposalController } from './proposal.controller';

@Module({
  imports: [DbModule.forFeature([ProposalReadRepository, DaoReadRepository])],
  controllers: [ProposalController],
  providers: [],
})
export class ProposalModule {}
