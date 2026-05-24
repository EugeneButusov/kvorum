import { Module } from '@nestjs/common';
import { pgDb } from '@libs/db';
import { ArchiveEventRepository, DaoSourceRepository, DlqRepository } from '@libs/db';
import { DlqDepthService } from '../orchestrator/dlq-depth.service';

@Module({
  providers: [
    { provide: DaoSourceRepository, useFactory: () => new DaoSourceRepository(pgDb) },
    { provide: ArchiveEventRepository, useFactory: () => new ArchiveEventRepository(pgDb) },
    { provide: DlqRepository, useFactory: () => new DlqRepository(pgDb) },
    DlqDepthService,
  ],
  exports: [DaoSourceRepository, ArchiveEventRepository, DlqRepository],
})
export class IndexerInfraModule {}
