import { Module } from '@nestjs/common';
import { DbModule } from '@nest/db';
import { DaoController } from './dao.controller';

@Module({
  imports: [DbModule],
  controllers: [DaoController],
  providers: [],
})
export class DaoModule {}
