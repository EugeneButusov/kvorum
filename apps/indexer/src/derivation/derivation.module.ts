import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  chDb,
  DlqRepository,
  ProposalRepository,
  pgDb,
} from '@libs/db';
import {
  COMPOUND_ACTOR_SWEEP_EXTRACTOR,
  CompTokenArchivePayloadRepository,
  GovernorArchivePayloadRepository,
} from '@sources/compound';
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
      ) =>
        new ActorSweepService(
          actorResolution,
          actors,
          dlq,
          new GovernorArchivePayloadRepository(chDb),
          new CompTokenArchivePayloadRepository(chDb),
          [COMPOUND_ACTOR_SWEEP_EXTRACTOR],
        ),
      inject: [ArchiveActorResolutionRepository, ActorRepository, DlqRepository],
    },
    TimestampFillerService,
  ],
})
export class DerivationModule {}
