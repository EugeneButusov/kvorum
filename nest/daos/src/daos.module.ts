import { Module } from '@nestjs/common';
import { DaoReadRepository, pgDb } from '@libs/db';

@Module({
  providers: [{ provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) }],
  exports: [DaoReadRepository],
})
export class DaoModule {}
