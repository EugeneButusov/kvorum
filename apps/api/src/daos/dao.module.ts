import { Module } from '@nestjs/common';
import { DaoReadRepository, pgDb } from '@libs/db';
import { DaoController } from './dao.controller';

@Module({
  providers: [{ provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) }],
  controllers: [DaoController],
})
export class DaoModule {}
