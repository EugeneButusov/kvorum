import { Module } from '@nestjs/common';
import { DaoReadRepository, pgDb } from '@libs/db';
import { DaoController } from './dao.controller';

@Module({
  controllers: [DaoController],
  providers: [
    {
      provide: DaoReadRepository,
      useFactory: () => new DaoReadRepository(pgDb),
    },
  ],
  exports: [DaoReadRepository],
})
export class DaoModule {}
