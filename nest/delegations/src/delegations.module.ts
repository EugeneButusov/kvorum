import { Module } from '@nestjs/common';
import { DaoReadRepository, DelegationReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';

// TODO(tech-debt): replace this dynamic-module re-export pattern with explicit
// repository provider wiring once the shared db module API is cleaned up.
const DELEGATIONS_DB_MODULE = DbModule.forFeature([DelegationReadRepository, DaoReadRepository]);

@Module({
  imports: [DELEGATIONS_DB_MODULE],
  exports: [DELEGATIONS_DB_MODULE],
})
export class DelegationsModule {}
