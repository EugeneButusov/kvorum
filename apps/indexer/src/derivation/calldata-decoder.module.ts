import { Logger, Module } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import {
  AbiCacheRepository,
  ProposalActionRepository,
  SelectorIndexRepository,
  pgDb,
} from '@libs/db';
import { loadAbiLibrary as loadAaveAbis } from '@sources/aave';
import { decodeByHeuristic, loadAbiLibrary as loadCompoundAbis } from '@sources/compound';
import {
  CalldataDecoder,
  ChainNotReadyError,
  EtherscanClient,
  type LoadedAbiLibrary,
  loadSharedAbiLibrary,
  readCalldataDecoderConfig,
} from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { toChainLogger } from '@nest/chain';
import { CalldataDecoderWorkerService } from './calldata-decoder-worker.service';

const bundledAbisFor = makeBundledAbiResolver();

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
          bundledAbisFor,
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

function makeBundledAbiResolver(): (sourceType: string) => LoadedAbiLibrary {
  const byFamily: Record<string, LoadedAbiLibrary> = {
    aave: loadAaveAbis(),
    compound: loadCompoundAbis(),
  };
  const sharedAbis = loadSharedAbiLibrary();

  return (sourceType: string) => byFamily[sourceFamilyOf(sourceType)] ?? sharedAbis;
}

function sourceFamilyOf(sourceType: string): string {
  const normalized = sourceType.replace(/_reconcile$/, '');
  if (normalized.startsWith('compound_governor_')) return 'compound';
  if (normalized.startsWith('aave_')) return 'aave';
  return normalized.split('_', 1)[0] ?? normalized;
}
