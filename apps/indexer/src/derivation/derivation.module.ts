import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ActorRepository, ArchiveDerivationRepository, ProposalRepository, pgDb } from '@libs/db';
import { ChainContextModule } from '@nest/chain';
import { SourcesModule } from '@nest/sources';
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
    DerivationWorkerService,
    TimestampFillerService,
  ],
})
export class DerivationModule {}
