import { Module } from '@nestjs/common';
import { DaoReadRepository, DelegationReadRepository, pgDb } from '@libs/db';

@Module({
  providers: [
    { provide: DelegationReadRepository, useFactory: () => new DelegationReadRepository(pgDb) },
    { provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) },
  ],
  exports: [DelegationReadRepository, DaoReadRepository],
})
export class DelegationsModule {}
