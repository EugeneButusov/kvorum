import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  DlqRepository,
  ProposalRepository,
  pgDb,
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
    DerivationWorkerService,
    {
      provide: ActorSweepService,
      useFactory: (
        actorResolution: ArchiveActorResolutionRepository,
        actors: ActorRepository,
        dlq: DlqRepository,
        plugins: readonly SourcePlugin[],
      ) => {
        const adapters: ActorSweepAdapter[] = plugins
          .flatMap((plugin) => plugin.derivers)
          .filter((deriver) => deriver.kind === 'actor-address')
          .map((deriver) => ({
            sourceTypes: deriver.sourceTypes,
            eventTypes: deriver.eventTypes,
            fetchPayloads: deriver.fetchPayloads,
            extractAddresses: (eventType, payload) =>
              deriver.extractAddresses(eventType, payload).map((candidate) => ({
                address: candidate.address,
                source:
                  (candidate as { source?: string }).source ?? candidate.role ?? 'unknown_event',
              })),
          }));

        return new ActorSweepService(actorResolution, actors, dlq, adapters);
      },
      inject: [ArchiveActorResolutionRepository, ActorRepository, DlqRepository, SOURCE_PLUGINS],
    },
    TimestampFillerService,
  ],
})
export class DerivationModule {}
