import { Logger, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  chDb,
  ProposalRepository,
  pgDb,
} from '@libs/db';
import { CompoundProjectionApplier } from '@sources/compound';
import { derivationMetrics } from './derivation-metrics';
import { DerivationWorkerService } from './derivation-worker.service';
import { PROJECTION_APPLIERS } from './projection-applier';
import { TimestampFillerService } from './timestamp-filler.service';
import { toChainLogger } from '../infra/nest-logger-adapter';
import { ChainContextRegistry } from '../orchestrator/chain-context-registry';

@Module({
  imports: [ScheduleModule.forRoot()],
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
      useFactory: () => new ArchiveDerivationRepository(pgDb, chDb),
    },
    {
      provide: CompoundProjectionApplier,
      useFactory: (archive: ArchiveDerivationRepository) =>
        new CompoundProjectionApplier({
          pgDb,
          chDb,
          archive,
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
    ChainContextRegistry,
    DerivationWorkerService,
    TimestampFillerService,
  ],
  exports: [ChainContextRegistry],
})
export class DerivationModule {}
