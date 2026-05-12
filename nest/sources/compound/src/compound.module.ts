import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ConfirmationRepository, DlqRepository } from '@libs/db';
import { ArchiveWriter, EventRepository, createCompoundGovernorPlugin } from '@sources/compound';
import { toChainLogger } from './utils/nest-logger-adapter';

export const COMPOUND_PLUGIN = 'COMPOUND_PLUGIN';

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
      provide: COMPOUND_PLUGIN,
      useFactory: (archiveWriter: ArchiveWriter, dlqRepo: DlqRepository) =>
        createCompoundGovernorPlugin({
          archiveWriter,
          dlqRepo,
          logger: toChainLogger(new Logger('CompoundGovernor')),
        }),
      inject: [ArchiveWriter, DlqRepository],
    },
  ],
  exports: [COMPOUND_PLUGIN],
})
export class CompoundSourceModule {}
