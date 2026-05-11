import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb, ConfirmationRepository, DlqRepository } from '@libs/db';
import { ChEventRepository, ArchiveWriter } from '@sources/compound';
import { CompoundGovernorService } from './compound-governor.service';
import { toChainLogger } from '../utils/nest-logger-adapter';

@Module({
  providers: [
    {
      provide: ArchiveWriter,
      useFactory: () => {
        const chRepo = new ChEventRepository({ chDb });
        const confirmationRepo = new ConfirmationRepository(pgDb);
        const dlqRepo = new DlqRepository(pgDb);
        return new ArchiveWriter({
          chRepo,
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
