import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ArchiveWriter } from '@libs/sources-compound';
import { toChainLogger } from '../../app/nest-logger-adapter';
import { CompoundGovernorService } from './compound-governor.service';

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
