import { Module } from '@nestjs/common';
import { DbModule } from '@nest/db';
import { ProposalController } from './proposal.controller';

@Module({
  imports: [DbModule],
  controllers: [ProposalController],
  providers: [],
})
export class ProposalModule {}
