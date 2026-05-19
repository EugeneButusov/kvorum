import { Module } from '@nestjs/common';
import { silentLogger } from '@libs/chain';
import { pgDb, chDb } from '@libs/db';
import { ConfirmationRepository, DlqRepository } from '@libs/db';
import { ArchiveWriter, EventRepository, createCompoundPlugins } from '@sources/compound';
import type { SourcePlugin } from '@sources/core';
import { SOURCE_PLUGINS } from '@sources/core';

@Module({
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (): SourcePlugin[] => {
        const confirmationRepo = new ConfirmationRepository(pgDb);
        const dlqRepo = new DlqRepository(pgDb);
        const archiveWriter = new ArchiveWriter({
          eventRepo: new EventRepository({ chDb }),
          confirmationRepo,
          dlqRepo,
          logger: silentLogger,
        });
        return createCompoundPlugins({ archiveWriter, dlqRepo, logger: silentLogger }).map((p) => ({
          ...p,
          supportedChainIds: ['0x7a69'],
        }));
      },
    },
  ],
  exports: [SOURCE_PLUGINS],
})
export class TestCompoundSourceModule {}
