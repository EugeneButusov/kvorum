import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ArchiveWriter } from '@sources/compound';
import { CompoundGovernorService } from './compound-governor.service';
import { toChainLogger } from '../utils/nest-logger-adapter';

@Module({
  providers: [
    {
      provide: ArchiveWriter,
      useFactory: () =>
        new ArchiveWriter({ pgDb, chDb, logger: toChainLogger(new Logger('ArchiveWriter')) }),
    },
    CompoundGovernorService,
  ],
  exports: [CompoundGovernorService],
})
export class CompoundGovernorModule {}
