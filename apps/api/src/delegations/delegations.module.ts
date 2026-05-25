import { Module } from '@nestjs/common';
import { DaoReadRepository, DelegationReadRepository, pgDb } from '@libs/db';
import { DelegationsController } from './delegations.controller';
import { ActorsModule } from '../actors/actors.module';

@Module({
  imports: [ActorsModule],
  providers: [
    { provide: DelegationReadRepository, useFactory: () => new DelegationReadRepository(pgDb) },
    { provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) },
  ],
  controllers: [DelegationsController],
})
export class DelegationsModule {}
