import { Logger, Module } from '@nestjs/common';
import {
  AbiCacheRepository,
  ProposalActionRepository,
  SelectorIndexRepository,
  pgDb,
} from '@libs/db';
import {
  CalldataDecoder,
  ChainNotReadyError,
  EtherscanClient,
  readCalldataDecoderConfig,
} from '@sources/core';
import { decodeByHeuristic, loadAbiLibrary } from '@sources/compound';
import { toChainLogger } from '../infra/nest-logger-adapter';
import { ChainContextModule } from '../orchestrator/chain-context.module';
import { ChainContextRegistry } from '../orchestrator/chain-context-registry';
import { CalldataDecoderWorkerService } from './calldata-decoder-worker.service';

@Module({
  imports: [ChainContextModule],
  providers: [
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
          decodeByHeuristic,
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
    {
      provide: CalldataDecoderWorkerService,
      useFactory: (actions: ProposalActionRepository, decoder: CalldataDecoder) =>
        new CalldataDecoderWorkerService(pgDb, actions, decoder),
      inject: [ProposalActionRepository, CalldataDecoder],
    },
  ],
})
export class CalldataDecoderModule {}
