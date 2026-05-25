import { Module } from '@nestjs/common';
import { DaoReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';
import { DaoController } from './dao.controller';

@Module({
  imports: [DbModule.forFeature([DaoReadRepository])],
  controllers: [DaoController],
  providers: [],
})
export class DaoModule {}
