import { Module, Logger } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import {
  ArchiveDerivationRepository,
  ConfirmationRepository,
  DlqRepository,
  chDb,
  pgDb,
} from '@libs/db';
import {
  COMPOUND_ACTOR_SWEEP_EXTRACTOR,
  CompTokenArchiveWriter,
  CompTokenArchivePayloadRepository,
  CompTokenEventRepository,
  CompoundProposalRepository,
  GovernorArchivePayloadRepository,
  GovernorArchiveWriter,
  GovernorEventRepository,
  GovernorProjectionApplier,
  GovernorVoteProjectionApplier,
  createCompTokenPlugin,
  createCompoundGovernorBravoReconcilePlugin,
  createCompoundGovernorOzReconcilePlugin,
  createCompoundPlugins,
} from '@sources/compound';
import type { SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { buildDriverMetrics } from './state-reconciler-metrics';
import { toChainLogger } from './utils/nest-logger-adapter';

export const COMPOUND_SOURCE_PLUGIN = 'COMPOUND_SOURCE_PLUGIN';

@Module({
  imports: [ChainContextModule],
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
      provide: GovernorProjectionApplier,
      useFactory: () =>
        new GovernorProjectionApplier({
          pgDb,
          chDb,
          archive: new ArchiveDerivationRepository(pgDb),
          payloads: new GovernorArchivePayloadRepository(chDb),
          metrics: {
            batchLookupSeconds: () => undefined,
            processed: () => undefined,
          },
          logger: toChainLogger(new Logger('GovernorProjectionApplier')),
        }),
    },
    {
      provide: GovernorVoteProjectionApplier,
      useFactory: (registry: ChainContextRegistry) =>
        new GovernorVoteProjectionApplier({
          pgDb,
          chDb,
          archive: new ArchiveDerivationRepository(pgDb),
          dlq: new DlqRepository(pgDb),
          payloads: new GovernorArchivePayloadRepository(chDb),
          registry,
          metrics: {
            batchLookupSeconds: () => undefined,
            processed: () => undefined,
          },
          logger: toChainLogger(new Logger('GovernorVoteProjectionApplier')),
        }),
      inject: [ChainContextRegistry],
    },
    {
      provide: COMPOUND_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: GovernorArchiveWriter,
        dlqRepo: DlqRepository,
        proposalRepo: CompoundProposalRepository,
        compTokenArchiveWriter: CompTokenArchiveWriter,
        projectionApplier: GovernorProjectionApplier,
        voteProjectionApplier: GovernorVoteProjectionApplier,
      ): SourcePlugin => {
        const governorPayloads = new GovernorArchivePayloadRepository(chDb);
        const compTokenPayloads = new CompTokenArchivePayloadRepository(chDb);
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
          derivers: [
            projectionApplier,
            voteProjectionApplier,
            {
              kind: 'actor-address',
              sourceTypes: COMPOUND_ACTOR_SWEEP_EXTRACTOR.sourceTypes,
              eventTypes: COMPOUND_ACTOR_SWEEP_EXTRACTOR.eventTypes,
              fetchPayloads: async (rows) => {
                if (rows.length === 0) return [];
                const sourceType = rows[0]!.source_type;
                if (
                  sourceType === 'compound_governor_alpha' ||
                  sourceType === 'compound_governor_bravo' ||
                  sourceType === 'compound_governor_oz'
                ) {
                  return governorPayloads.fetchPayloads(rows);
                }
                if (sourceType === 'compound_comp_token') {
                  return compTokenPayloads.fetchPayloads(rows);
                }
                throw new Error(`unsupported source_type for actor sweep: ${sourceType}`);
              },
              extractAddresses: COMPOUND_ACTOR_SWEEP_EXTRACTOR.extractAddresses,
            },
          ],
        };
      },
      inject: [
        GovernorArchiveWriter,
        DlqRepository,
        CompoundProposalRepository,
        CompTokenArchiveWriter,
        GovernorProjectionApplier,
        GovernorVoteProjectionApplier,
      ],
    },
  ],
  exports: [COMPOUND_SOURCE_PLUGIN],
})
export class CompoundSourceModule {}
