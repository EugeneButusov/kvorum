import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ArchiveRepository, ArchiveWriter } from '@sources/compound';
import { CompoundGovernorService } from './compound-governor.service';
import { toChainLogger } from '../utils/nest-logger-adapter';

@Module({
  providers: [
    {
      provide: ArchiveWriter,
      useFactory: () => {
        const repo = new ArchiveRepository({ pgDb, chDb });
        return new ArchiveWriter({ repo, logger: toChainLogger(new Logger('ArchiveWriter')) });
      },
    },
    CompoundGovernorService,
  ],
  exports: [CompoundGovernorService],
})
export class CompoundGovernorModule {}
