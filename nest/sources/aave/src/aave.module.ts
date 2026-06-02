import { Logger, Module } from '@nestjs/common';
import { ArchiveEventRepository, DlqRepository, chDb } from '@libs/db';
import {
  AaveGovernanceArchiveWriter,
  AaveGovernanceEventRepository,
  createAaveGovernanceV3Plugin,
} from '@sources/aave';
import type { SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { toChainLogger } from '@nest/chain';
import { DbModule } from '@nest/db';

export const AAVE_SOURCE_PLUGIN = 'AAVE_SOURCE_PLUGIN';

@Module({
  imports: [ChainContextModule, DbModule.forFeature([ArchiveEventRepository, DlqRepository])],
  providers: [
    {
      provide: AaveGovernanceArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) =>
        new AaveGovernanceArchiveWriter({
          eventRepo: new AaveGovernanceEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('AaveGovernanceArchiveWriter')),
        }),
      inject: [ArchiveEventRepository, DlqRepository],
    },
    {
      provide: AAVE_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: AaveGovernanceArchiveWriter,
        dlqRepo: DlqRepository,
      ): SourcePlugin => ({
        name: 'aave',
        ingesters: [
          createAaveGovernanceV3Plugin({
            archiveWriter,
            dlqRepo,
            logger: toChainLogger(new Logger('AaveGovernanceV3')),
          }),
        ],
        derivers: [],
        snapshotStrategies: [],
      }),
      inject: [AaveGovernanceArchiveWriter, DlqRepository],
    },
  ],
  exports: [AAVE_SOURCE_PLUGIN],
})
export class AaveSourceModule {}
