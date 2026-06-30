import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ChainContextRegistry } from '@libs/chain';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  DlqRepository,
  ProposalRepository,
  pgDb,
  type ArchiveDerivationRow,
  type OffchainArchiveRow,
} from '@libs/db';
import { SOURCE_PLUGINS, type ActorSweepAdapter, type SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { SourcesModule } from '@nest/sources';
import { ActorSweepService } from './actor-sweep.service';
import { CalldataDecoderModule } from './calldata-decoder.module';
import { DerivationWorkerService } from './derivation-worker.service';
import { TimestampFillerService } from './timestamp-filler.service';

@Module({
  imports: [ScheduleModule.forRoot(), ChainContextModule, CalldataDecoderModule, SourcesModule],
  providers: [
    {
      provide: ActorRepository,
      useFactory: () => new ActorRepository(pgDb),
    },
    {
      provide: ProposalRepository,
      useFactory: () => new ProposalRepository(pgDb),
    },
    {
      provide: ArchiveDerivationRepository,
      useFactory: () => new ArchiveDerivationRepository(pgDb),
    },
    {
      provide: ArchiveActorResolutionRepository,
      useFactory: () => new ArchiveActorResolutionRepository(pgDb),
    },
    {
      provide: DlqRepository,
      useFactory: () => new DlqRepository(pgDb),
    },
    {
      provide: DerivationWorkerService,
      useFactory: (
        archive: ArchiveDerivationRepository,
        actorResolution: ArchiveActorResolutionRepository,
        registry: ChainContextRegistry,
        plugins: readonly SourcePlugin[],
      ) => new DerivationWorkerService(archive, actorResolution, registry, plugins),
      inject: [
        ArchiveDerivationRepository,
        ArchiveActorResolutionRepository,
        ChainContextRegistry,
        SOURCE_PLUGINS,
      ],
    },
    {
      provide: ActorSweepService,
      useFactory: (
        actorResolution: ArchiveActorResolutionRepository,
        actors: ActorRepository,
        dlq: DlqRepository,
        plugins: readonly SourcePlugin[],
      ) => {
        // Normalize both EVM (`actor-address`) and off-chain (`offchain-actor-address`) derivers onto
        // the single ActorSweepAdapter shape so the sweep has one code path. The dispatch is by
        // source_type, so each adapter only ever receives rows of its own transport (cast-safe).
        const derivers = plugins.flatMap((plugin) => plugin.derivers);
        const adapters: ActorSweepAdapter[] = derivers
          .filter((deriver) => deriver.kind === 'actor-address')
          .map((deriver) => ({
            sourceTypes: deriver.sourceTypes,
            eventTypes: deriver.eventTypes,
            fetchPayloads: (rows) => deriver.fetchPayloads(rows as readonly ArchiveDerivationRow[]),
            extractAddresses: (eventType, payload) =>
              deriver.extractAddresses(eventType, payload).map((candidate) => ({
                address: candidate.address,
                source:
                  (candidate as { source?: string }).source ?? candidate.role ?? 'unknown_event',
              })),
          }));
        const offchainAdapters: ActorSweepAdapter[] = derivers
          .filter((deriver) => deriver.kind === 'offchain-actor-address')
          .map((deriver) => ({
            sourceTypes: deriver.sourceTypes,
            eventTypes: deriver.eventTypes,
            fetchPayloads: (rows) => deriver.fetchPayloads(rows as readonly OffchainArchiveRow[]),
            extractAddresses: (eventType, payload) =>
              deriver.extractAddresses(eventType, payload).map((candidate) => ({
                address: candidate.address,
                source: candidate.role ?? 'unknown_event',
              })),
          }));

        return new ActorSweepService(actorResolution, actors, dlq, [
          ...adapters,
          ...offchainAdapters,
        ]);
      },
      inject: [ArchiveActorResolutionRepository, ActorRepository, DlqRepository, SOURCE_PLUGINS],
    },
    TimestampFillerService,
  ],
})
export class DerivationModule {}
