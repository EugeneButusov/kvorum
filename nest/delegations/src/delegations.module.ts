import { Module } from '@nestjs/common';
import { DaoReadRepository, DelegationReadRepository, chDb, pgDb } from '@libs/db';

@Module({
  providers: [
    {
      provide: DelegationReadRepository,
      useFactory: () => new DelegationReadRepository(pgDb, chDb as never),
    },
    { provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) },
  ],
  exports: [DelegationReadRepository, DaoReadRepository],
})
export class DelegationsModule {}
