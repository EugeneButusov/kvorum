import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  DlqRepository,
  ProposalRepository,
  chDb,
  pgDb,
} from '@libs/db';
import {
  COMPOUND_ACTOR_SWEEP_EXTRACTOR,
  CompTokenArchivePayloadRepository,
  GovernorArchivePayloadRepository,
} from '@sources/compound';
import type { ActorSweepAdapter } from '@sources/core';
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
      ) => {
        const governorPayloads = new GovernorArchivePayloadRepository(chDb);
        const compTokenPayloads = new CompTokenArchivePayloadRepository(chDb);
        const adapters: ActorSweepAdapter[] = [
          {
            sourceTypes: COMPOUND_ACTOR_SWEEP_EXTRACTOR.sourceTypes,
            eventTypes: COMPOUND_ACTOR_SWEEP_EXTRACTOR.eventTypes,
            extractAddresses: COMPOUND_ACTOR_SWEEP_EXTRACTOR.extractAddresses,
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
          },
        ];

        return new ActorSweepService(actorResolution, actors, dlq, adapters);
      },
      inject: [ArchiveActorResolutionRepository, ActorRepository, DlqRepository],
    },
    TimestampFillerService,
  ],
})
export class DerivationModule {}
