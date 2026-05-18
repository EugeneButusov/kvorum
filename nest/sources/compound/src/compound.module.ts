import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ConfirmationRepository, DlqRepository } from '@libs/db';
import {
  ArchiveWriter,
  CompoundProposalRepository,
  EventRepository,
  createCompoundPlugins,
} from '@sources/compound';
import type { SourcePlugin } from '@sources/core';
import { CompoundReconcileService } from './compound-reconcile.service';
import { toChainLogger } from './utils/nest-logger-adapter';

export const COMPOUND_PLUGINS = 'COMPOUND_PLUGINS';

@Module({
  providers: [
    {
      provide: ConfirmationRepository,
      useFactory: () => new ConfirmationRepository(pgDb),
    },
    {
      provide: DlqRepository,
      useFactory: () => new DlqRepository(pgDb),
    },
    {
      provide: ArchiveWriter,
      useFactory: () => {
        const eventRepo = new EventRepository({ chDb });
        const confirmationRepo = new ConfirmationRepository(pgDb);
        const dlqRepo = new DlqRepository(pgDb);
        return new ArchiveWriter({
          eventRepo,
          confirmationRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('ArchiveWriter')),
        });
      },
    },
    {
      provide: COMPOUND_PLUGINS,
      useFactory: (archiveWriter: ArchiveWriter, dlqRepo: DlqRepository): SourcePlugin[] => {
        return [
          ...createCompoundPlugins({
            archiveWriter,
            dlqRepo,
            logger: toChainLogger(new Logger('CompoundGovernor')),
          }),
        ];
      },
      inject: [ArchiveWriter, DlqRepository],
    },
    {
      provide: CompoundProposalRepository,
      useFactory: () => new CompoundProposalRepository(pgDb),
    },
    CompoundReconcileService,
  ],
  exports: [COMPOUND_PLUGINS, CompoundProposalRepository],
})
export class CompoundSourceModule {}
