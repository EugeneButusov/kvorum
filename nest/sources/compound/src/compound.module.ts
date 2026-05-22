import { Module, Logger } from '@nestjs/common';
import { pgDb, chDb } from '@libs/db';
import { ArchiveDerivationRepository } from '@libs/db';
import { ConfirmationRepository, DlqRepository } from '@libs/db';
import {
  CompTokenArchiveWriter,
  CompTokenEventRepository,
  CompoundArchivePayloadRepository,
  CompoundProposalRepository,
  CompoundProjectionApplier,
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

export const COMPOUND_SOURCE_PLUGIN = 'COMPOUND_SOURCE_PLUGIN';

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
      provide: ArchiveDerivationRepository,
      useFactory: () => new ArchiveDerivationRepository(pgDb),
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
      provide: CompoundProjectionApplier,
      useFactory: (archive: ArchiveDerivationRepository) =>
        new CompoundProjectionApplier({
          pgDb,
          chDb,
          archive,
          payloads: new CompoundArchivePayloadRepository(chDb),
          metrics: {
            batchLookupSeconds: () => undefined,
            processed: () => undefined,
          },
          logger: toChainLogger(new Logger('CompoundProjectionApplier')),
        }),
      inject: [ArchiveDerivationRepository],
    },
    {
      provide: COMPOUND_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: GovernorArchiveWriter,
        dlqRepo: DlqRepository,
        proposalRepo: CompoundProposalRepository,
        compTokenArchiveWriter: CompTokenArchiveWriter,
        projectionApplier: CompoundProjectionApplier,
      ): SourcePlugin => {
        const reconcileLogger = toChainLogger(new Logger('CompoundReconcile'));
        const metrics = buildDriverMetrics();
        const logger = new Logger('CompoundSourceModule');
        logger.log('compound_comp_token plugin registered');

        return {
          name: 'compound',
          ingesters: [
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
          ],
          derivers: [projectionApplier],
        };
      },
      inject: [
        GovernorArchiveWriter,
        DlqRepository,
        CompoundProposalRepository,
        CompTokenArchiveWriter,
        CompoundProjectionApplier,
      ],
    },
  ],
  exports: [COMPOUND_SOURCE_PLUGIN],
})
export class CompoundSourceModule {}
