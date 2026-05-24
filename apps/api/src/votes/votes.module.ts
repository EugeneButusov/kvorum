import { Module } from '@nestjs/common';
import { pgDb, ProposalReadRepository, VoteReadRepository } from '@libs/db';
import { VotesController } from './votes.controller';
import { ActorsModule } from '../actors/actors.module';

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
