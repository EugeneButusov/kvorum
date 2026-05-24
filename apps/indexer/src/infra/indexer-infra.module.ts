import { Module } from '@nestjs/common';
import { pgDb } from '@libs/db';
import {
  ArchiveEventRepository,
  DaoSourceRepository,
  DlqRepository,
  ReorgEventRepository,
} from '@libs/db';
import { DlqDepthService } from '../orchestrator/dlq-depth.service';

@Module({
  providers: [
    { provide: DaoSourceRepository, useFactory: () => new DaoSourceRepository(pgDb) },
    { provide: ArchiveEventRepository, useFactory: () => new ArchiveEventRepository(pgDb) },
    { provide: DlqRepository, useFactory: () => new DlqRepository(pgDb) },
    { provide: ReorgEventRepository, useFactory: () => new ReorgEventRepository(pgDb) },
    DlqDepthService,
  ],
  exports: [DaoSourceRepository, ArchiveEventRepository, DlqRepository, ReorgEventRepository],
})
export class IndexerInfraModule {}
