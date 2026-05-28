import { Module } from '@nestjs/common';
import { ProposalReadRepository, VoteReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';

@Module({
  imports: [DbModule.forFeature([VoteReadRepository, ProposalReadRepository])],
  providers: [
    { provide: VoteReadRepository, useExisting: VoteReadRepository },
    { provide: ProposalReadRepository, useExisting: ProposalReadRepository },
  ],
  exports: [VoteReadRepository, ProposalReadRepository],
})
export class VotesModule {}
