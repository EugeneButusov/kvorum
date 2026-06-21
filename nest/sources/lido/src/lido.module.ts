import { Logger, Module } from '@nestjs/common';
import { ArchiveEventRepository, DlqRepository, chDb } from '@libs/db';
import type { SourcePlugin } from '@sources/core';
import {
  AragonVotingEventRepository,
  LidoAragonVotingArchiveWriter,
  createLidoAragonVotingPlugin,
  makeLidoReadExtension,
} from '@sources/lido';
import { toChainLogger } from '@nest/chain';
import { DbModule } from '@nest/db';

export const LIDO_SOURCE_PLUGIN = 'LIDO_SOURCE_PLUGIN';

@Module({
  imports: [DbModule.forFeature([ArchiveEventRepository, DlqRepository])],
  providers: [
    {
      provide: LidoAragonVotingArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) =>
        new LidoAragonVotingArchiveWriter({
          eventRepo: new AragonVotingEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('LidoAragonVotingArchiveWriter')),
        }),
      inject: [ArchiveEventRepository, DlqRepository],
    },
    {
      provide: LIDO_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: LidoAragonVotingArchiveWriter,
        dlqRepo: DlqRepository,
      ): SourcePlugin => ({
        name: 'lido',
        ingesters: [
          createLidoAragonVotingPlugin({
            archiveWriter,
            dlqRepo,
            logger: toChainLogger(new Logger('LidoAragonVoting')),
          }),
          // AG1: register aragon_voting_reconcile ingester + admin-cli backfill/DLQ-retry entry.
        ],
        derivers: [],
        readExtension: makeLidoReadExtension(),
      }),
      inject: [LidoAragonVotingArchiveWriter, DlqRepository],
    },
  ],
  exports: [LIDO_SOURCE_PLUGIN],
})
export class LidoSourceModule {}
