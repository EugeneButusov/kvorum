import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ConfirmationRepository, DlqRepository } from '@libs/db';
import {
  ArchiveWriter,
  CompTokenArchiveWriter,
  CompTokenEventRepository,
  CompoundProposalRepository,
  EventRepository,
  createCompTokenPlugin,
  createCompoundPlugins,
  createCompoundGovernorBravoReconcilePlugin,
  createCompoundGovernorOzReconcilePlugin,
} from '@sources/compound';
import type { SourcePlugin } from '@sources/core';
import { buildDriverMetrics } from './state-reconciler-metrics';
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
      provide: CompoundProposalRepository,
      useFactory: () => new CompoundProposalRepository(pgDb),
    },
    {
      provide: CompTokenEventRepository,
      useFactory: () => new CompTokenEventRepository({ chDb }),
    },
    {
      provide: CompTokenArchiveWriter,
      useFactory: (
        eventRepo: CompTokenEventRepository,
        confirmationRepo: ConfirmationRepository,
        dlqRepo: DlqRepository,
      ) =>
        new CompTokenArchiveWriter({
          eventRepo,
          confirmationRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('CompTokenArchiveWriter')),
        }),
      inject: [CompTokenEventRepository, ConfirmationRepository, DlqRepository],
    },
    {
      provide: COMPOUND_PLUGINS,
      useFactory: (
        archiveWriter: ArchiveWriter,
        dlqRepo: DlqRepository,
        proposalRepo: CompoundProposalRepository,
        compTokenArchiveWriter: CompTokenArchiveWriter,
      ): SourcePlugin[] => {
        const reconcileLogger = toChainLogger(new Logger('CompoundReconcile'));
        const metrics = buildDriverMetrics();
        const logger = new Logger('CompoundSourceModule');
        logger.log('compound_comp_token plugin registered');
        return [
          ...createCompoundPlugins({
            archiveWriter,
            dlqRepo,
            logger: toChainLogger(new Logger('CompoundGovernor')),
          }),
          createCompTokenPlugin({
            archiveWriter: compTokenArchiveWriter,
            dlqRepo,
            logger: toChainLogger(new Logger('CompTokenIngester')),
          }),
          createCompoundGovernorBravoReconcilePlugin({
            proposals: proposalRepo,
            metrics,
            logger: reconcileLogger,
          }),
          createCompoundGovernorOzReconcilePlugin({
            proposals: proposalRepo,
            metrics,
            logger: reconcileLogger,
          }),
        ];
      },
      inject: [ArchiveWriter, DlqRepository, CompoundProposalRepository, CompTokenArchiveWriter],
    },
  ],
  exports: [COMPOUND_PLUGINS],
})
export class CompoundSourceModule {}
