import { Module } from '@nestjs/common';
import { DaoReadRepository, DelegationReadRepository } from '@libs/db';
import { DbModule } from '@nest/db';

@Module({
  imports: [DbModule.forFeature([DelegationReadRepository, DaoReadRepository])],
  providers: [
    { provide: DelegationReadRepository, useExisting: DelegationReadRepository },
    { provide: DaoReadRepository, useExisting: DaoReadRepository },
  ],
  exports: [DelegationReadRepository, DaoReadRepository],
})
export class DelegationsModule {}
