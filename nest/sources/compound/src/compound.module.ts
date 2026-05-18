import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ConfirmationRepository, DlqRepository } from '@libs/db';
import {
  ArchiveWriter,
  CompoundStateReconciler,
  EventRepository,
  createCompoundPlugins,
} from '@sources/compound';
import type { ProposalStateReconcilerPlugin, SourcePlugin } from '@sources/core';
import { toChainLogger } from './utils/nest-logger-adapter';

export const COMPOUND_PLUGINS = 'COMPOUND_PLUGINS';
export const COMPOUND_RECONCILERS = 'COMPOUND_RECONCILERS';

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
      provide: COMPOUND_RECONCILERS,
      useFactory: (): ProposalStateReconcilerPlugin[] => {
        return [
          new CompoundStateReconciler('0x1', toChainLogger(new Logger('CompoundStateReconciler'))),
        ];
      },
    },
  ],
  exports: [COMPOUND_PLUGINS, COMPOUND_RECONCILERS],
})
export class CompoundSourceModule {}
