import { Module } from '@nestjs/common';
import { DaoReadRepository, DelegationReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';

const DELEGATIONS_DB_MODULE = DbModule.forFeature([DelegationReadRepository, DaoReadRepository]);

@Module({
  imports: [DELEGATIONS_DB_MODULE],
  exports: [DELEGATIONS_DB_MODULE],
})
export class DelegationsModule {}
