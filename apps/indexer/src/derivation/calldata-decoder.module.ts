import { Logger, Module } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import {
  AbiCacheRepository,
  ProposalActionRepository,
  SelectorIndexRepository,
  pgDb,
} from '@libs/db';
import { aaveCalldataProtocol } from '@sources/aave';
import { compoundCalldataProtocol } from '@sources/compound';
import {
  type CalldataProtocolSupport,
  CalldataDecoder,
  ChainNotReadyError,
  EtherscanClient,
  type LoadedAbiLibrary,
  type HeuristicResult,
  loadSharedAbiLibrary,
  readCalldataDecoderConfig,
} from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { toChainLogger } from '@nest/chain';
import { CalldataDecoderWorkerService } from './calldata-decoder-worker.service';

const protocols: readonly CalldataProtocolSupport[] = [
  aaveCalldataProtocol,
  compoundCalldataProtocol,
];
const bundledAbisFor = makeBundledAbiResolver(protocols);
const decodeByHeuristic = makeHeuristicDecoder(protocols);

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

function makeBundledAbiResolver(
  protocols: readonly CalldataProtocolSupport[],
): (sourceType: string) => LoadedAbiLibrary {
  const libraries = protocols.map((protocol) => ({
    supportsSourceType: protocol.supportsSourceType,
    library: protocol.loadAbiLibrary(),
  }));
  const sharedAbis = loadSharedAbiLibrary();

  return (sourceType: string) =>
    libraries.find((protocol) => protocol.supportsSourceType(sourceType))?.library ?? sharedAbis;
}

function makeHeuristicDecoder(
  protocols: readonly CalldataProtocolSupport[],
): ((calldata: string) => HeuristicResult | null) | undefined {
  const decoders = protocols.flatMap((protocol) =>
    protocol.decodeByHeuristic ? [protocol.decodeByHeuristic] : [],
  );
  if (decoders.length === 0) return undefined;

  return (calldata: string) => {
    for (const decode of decoders) {
      const result = decode(calldata);
      if (result !== null) return result;
    }
    return null;
  };
}
