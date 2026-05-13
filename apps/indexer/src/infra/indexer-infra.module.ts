import { Module } from '@nestjs/common';
import { pgDb } from '@libs/db';
import {
  ConfirmationRepository,
  DaoSourceRepository,
  DlqRepository,
  ReorgEventRepository,
} from '@libs/db';
import { DlqDepthService } from '../orchestrator/dlq-depth.service';

@Module({
  providers: [
    { provide: DaoSourceRepository, useFactory: () => new DaoSourceRepository(pgDb) },
    { provide: ConfirmationRepository, useFactory: () => new ConfirmationRepository(pgDb) },
    { provide: DlqRepository, useFactory: () => new DlqRepository(pgDb) },
    { provide: ReorgEventRepository, useFactory: () => new ReorgEventRepository(pgDb) },
    DlqDepthService,
  ],
  exports: [DaoSourceRepository, ConfirmationRepository, DlqRepository, ReorgEventRepository],
})
export class IndexerInfraModule {}
