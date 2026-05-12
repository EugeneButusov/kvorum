import { Module } from '@nestjs/common';
import { pgDb } from '@libs/db';
import { ConfirmationRepository, DaoSourceRepository, DlqRepository } from '@libs/db';

@Module({
  providers: [
    { provide: DaoSourceRepository, useFactory: () => new DaoSourceRepository(pgDb) },
    { provide: ConfirmationRepository, useFactory: () => new ConfirmationRepository(pgDb) },
    { provide: DlqRepository, useFactory: () => new DlqRepository(pgDb) },
  ],
  exports: [DaoSourceRepository, ConfirmationRepository, DlqRepository],
})
export class IndexerInfraModule {}
