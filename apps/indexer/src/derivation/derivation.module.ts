import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  chDb,
  DlqRepository,
  ProposalRepository,
  pgDb,
} from '@libs/db';
import { CompTokenArchivePayloadRepository, GovernorArchivePayloadRepository } from '@sources/compound';
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
      provide: DlqRepository,
      useFactory: () => new DlqRepository(pgDb),
    },
    DerivationWorkerService,
    {
      provide: ActorSweepService,
      useFactory: (archive: ArchiveDerivationRepository, actors: ActorRepository, dlq: DlqRepository) =>
        new ActorSweepService(
          archive,
          actors,
          dlq,
          new GovernorArchivePayloadRepository(chDb),
          new CompTokenArchivePayloadRepository(chDb),
        ),
      inject: [ArchiveDerivationRepository, ActorRepository, DlqRepository],
    },
    TimestampFillerService,
  ],
})
export class DerivationModule {}
