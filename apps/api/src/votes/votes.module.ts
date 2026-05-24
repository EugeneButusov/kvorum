import { Module } from '@nestjs/common';
import { pgDb, ProposalReadRepository, VoteReadRepository } from '@libs/db';
import { ActorsModule } from '../actors/actors.module';
import { VotesController } from './votes.controller';

@Module({
  imports: [ActorsModule],
  controllers: [VotesController],
  providers: [
    {
      provide: VoteReadRepository,
      useFactory: () => new VoteReadRepository(pgDb),
    },
    {
      provide: ProposalReadRepository,
      useFactory: () => new ProposalReadRepository(pgDb),
    },
  ],
})
export class VotesModule {}
