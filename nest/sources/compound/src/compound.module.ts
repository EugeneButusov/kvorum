import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ConfirmationRepository, DlqRepository } from '@libs/db';
import {
  CompTokenArchiveWriter,
  CompTokenEventRepository,
  CompoundProposalRepository,
  GovernorArchiveWriter,
  GovernorEventRepository,
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
      provide: GovernorArchiveWriter,
      useFactory: () => {
        const eventRepo = new GovernorEventRepository({ chDb });
        const confirmationRepo = new ConfirmationRepository(pgDb);
        const dlqRepo = new DlqRepository(pgDb);
        return new GovernorArchiveWriter({
          eventRepo,
          confirmationRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('GovernorArchiveWriter')),
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
        archiveWriter: GovernorArchiveWriter,
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
      inject: [
        GovernorArchiveWriter,
        DlqRepository,
        CompoundProposalRepository,
        CompTokenArchiveWriter,
      ],
    },
  ],
  exports: [COMPOUND_PLUGINS],
})
export class CompoundSourceModule {}
