import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ConfirmationRepository, DlqRepository } from '@libs/db';
import { ArchiveWriter, EventRepository, createCompoundPlugins } from '@sources/compound';
import type { SourcePlugin } from '@sources/core';
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
        const plugins = createCompoundPlugins({
          archiveWriter,
          dlqRepo,
          logger: toChainLogger(new Logger('CompoundGovernor')),
        });
        const chainOverride = process.env['COMPOUND_SUPPORTED_CHAIN_IDS']?.split(',');
        if (chainOverride) {
          return plugins.map((p) => ({ ...p, supportedChainIds: chainOverride }));
        }
        return [...plugins];
      },
      inject: [ArchiveWriter, DlqRepository],
    },
  ],
  exports: [COMPOUND_PLUGINS],
})
export class CompoundSourceModule {}
