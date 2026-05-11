import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb, ConfirmationRepository, DaoSourceRepository, DlqRepository } from '@libs/db';
import { EventRepository, ArchiveWriter } from '@sources/compound';
import { CompoundGovernorService } from './compound-governor.service';
import { toChainLogger } from '../utils/nest-logger-adapter';

@Module({
  providers: [
    {
      provide: DaoSourceRepository,
      useFactory: () => new DaoSourceRepository(pgDb),
    },
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
    CompoundGovernorService,
  ],
  exports: [CompoundGovernorService],
})
export class CompoundGovernorModule {}
