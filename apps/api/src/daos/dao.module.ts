import { Module } from '@nestjs/common';
import { DaoReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';
import { DaoController } from './dao.controller';

@Module({
  imports: [DbModule],
  controllers: [DaoController],
  providers: [],
  exports: [DaoReadRepository],
})
export class DaoModule {}
