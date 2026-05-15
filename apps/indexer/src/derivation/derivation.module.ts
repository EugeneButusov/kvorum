import { Logger, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  chDb,
  ProposalRepository,
  pgDb,
} from '@libs/db';
import { CompoundArchivePayloadRepository, CompoundProjectionApplier } from '@sources/compound';
import { CalldataDecoderModule } from './calldata-decoder.module';
import { derivationMetrics } from './derivation-metrics';
import { DerivationWorkerService } from './derivation-worker.service';
import { PROJECTION_APPLIERS } from './projection-applier';
import { TimestampFillerService } from './timestamp-filler.service';
import { toChainLogger } from '../infra/nest-logger-adapter';
import { ChainContextRegistry } from '../orchestrator/chain-context-registry';
import { ChainContextModule } from '../orchestrator/chain-context.module';

@Module({
  imports: [ScheduleModule.forRoot(), ChainContextModule, CalldataDecoderModule],
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
      provide: CompoundProjectionApplier,
      useFactory: (archive: ArchiveDerivationRepository) =>
        new CompoundProjectionApplier({
          pgDb,
          chDb,
          archive,
          payloads: new CompoundArchivePayloadRepository(chDb),
          metrics: {
            batchLookupSeconds: (seconds) => derivationMetrics.batchLookupSeconds.record(seconds),
            processed: (labels) =>
              derivationMetrics.processed.add(1, {
                ...labels,
                reason: labels.reason ?? undefined,
              }),
          },
          logger: toChainLogger(new Logger('CompoundProjectionApplier')),
        }),
      inject: [ArchiveDerivationRepository],
    },
    {
      provide: PROJECTION_APPLIERS,
      useFactory: (compound: CompoundProjectionApplier) => [compound],
      inject: [CompoundProjectionApplier],
    },
    DerivationWorkerService,
    TimestampFillerService,
  ],
  exports: [ChainContextRegistry],
})
export class DerivationModule {}
