import { Logger, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ActorRepository,
  AbiCacheRepository,
  ArchiveDerivationRepository,
  chDb,
  ProposalRepository,
  ProposalActionRepository,
  SelectorIndexRepository,
  pgDb,
} from '@libs/db';
import {
  CalldataDecoder,
  ChainNotReadyError,
  CompoundArchivePayloadRepository,
  CompoundProjectionApplier,
  EtherscanClient,
  loadAbiLibrary,
  readCalldataDecoderConfig,
} from '@sources/compound';
import { CalldataDecoderWorkerService } from './calldata-decoder-worker.service';
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
      useFactory: () => new ArchiveDerivationRepository(pgDb),
    },
    {
      provide: AbiCacheRepository,
      useFactory: () => new AbiCacheRepository(pgDb),
    },
    {
      provide: SelectorIndexRepository,
      useFactory: () => new SelectorIndexRepository(pgDb),
    },
    {
      provide: ProposalActionRepository,
      useFactory: () => new ProposalActionRepository(pgDb),
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
    {
      provide: CalldataDecoder,
      useFactory: (
        abiCache: AbiCacheRepository,
        selectorIndex: SelectorIndexRepository,
        chains: ChainContextRegistry,
      ) =>
        new CalldataDecoder({
          abiCache,
          selectorIndex,
          bundledAbis: loadAbiLibrary(),
          proxyResolverFor: (chainId) => {
            const ctx = chains.peek(chainId);
            if (!ctx) throw new ChainNotReadyError(chainId);
            return ctx.proxyResolver;
          },
          etherscanClient: (() => {
            const cfg = readCalldataDecoderConfig();
            return cfg.etherscan.enabled
              ? new EtherscanClient({
                  ...cfg.etherscan,
                  logger: toChainLogger(new Logger('EtherscanClient')),
                })
              : null;
          })(),
          logger: toChainLogger(new Logger('CalldataDecoder')),
        }),
      inject: [AbiCacheRepository, SelectorIndexRepository, ChainContextRegistry],
    },
    ChainContextRegistry,
    DerivationWorkerService,
    TimestampFillerService,
    {
      provide: CalldataDecoderWorkerService,
      useFactory: (actions: ProposalActionRepository, decoder: CalldataDecoder) =>
        new CalldataDecoderWorkerService(pgDb, actions, decoder),
      inject: [ProposalActionRepository, CalldataDecoder],
    },
  ],
  exports: [ChainContextRegistry],
})
export class DerivationModule {}
