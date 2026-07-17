import { Module } from '@nestjs/common';
import { pgDb } from '@libs/db';
import {
  ArchiveEventRepository,
  DaoSourceRepository,
  DlqRepository,
  OffChainCursorRepository,
} from '@libs/db';
import { DlqDepthService } from '../orchestrator/dlq-depth.service';

@Module({
  providers: [
    /* v8 ignore next -- prod-only-DI: useFactory closures only execute inside a live Nest container */
    { provide: DaoSourceRepository, useFactory: () => new DaoSourceRepository(pgDb) },
    /* v8 ignore next -- prod-only-DI */
    { provide: ArchiveEventRepository, useFactory: () => new ArchiveEventRepository(pgDb) },
    /* v8 ignore next -- prod-only-DI */
    { provide: DlqRepository, useFactory: () => new DlqRepository(pgDb) },
    /* v8 ignore next -- prod-only-DI */
    { provide: OffChainCursorRepository, useFactory: () => new OffChainCursorRepository(pgDb) },
    DlqDepthService,
  ],
  exports: [DaoSourceRepository, ArchiveEventRepository, DlqRepository, OffChainCursorRepository],
})
export class IndexerInfraModule {}
