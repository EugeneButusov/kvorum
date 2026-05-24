import { Module } from '@nestjs/common';
import { DaoReadRepository, DelegationReadRepository, pgDb } from '@libs/db';
import { DelegationsController } from './delegations.controller';
import { ActorsModule } from '../actors/actors.module';

@Module({
  imports: [ActorsModule],
  controllers: [DelegationsController],
  providers: [
    {
      provide: DelegationReadRepository,
      useFactory: () => new DelegationReadRepository(pgDb),
    },
    {
      provide: DaoReadRepository,
      useFactory: () => new DaoReadRepository(pgDb),
    },
  ],
})
export class DelegationsModule {}
