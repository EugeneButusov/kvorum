import type { ProxyResolver, Logger } from '@libs/chain';
import type { AbiCacheRepository, SelectorIndexRepository } from '@libs/db';
import type { LoadedAbiLibrary } from './abi-library';

export type DecodeSource =
  | 'empty_calldata'
  | 'heuristic'
  | 'event_emitted'
  | 'abi_cache'
  | 'bundled_library'
  | 'proxy_resolved'
  | 'etherscan';

export type DecodeResult =
  | {
      kind: 'decoded';
      decodedFunction: string;
      decodedArguments: Record<string, unknown>;
      source: DecodeSource;
    }
  | {
      kind: 'partial';
      decodedFunction: null;
      functionSignatureGuess: string;
      source: 'selector_index';
    }
  | { kind: 'miss' };

export interface EtherscanClientLike {
  fetchAbi(chainId: string, address: string): Promise<readonly unknown[] | null>;
}

export interface DecoderDependencies {
  abiCache: AbiCacheRepository;
  selectorIndex: SelectorIndexRepository;
  bundledAbis: LoadedAbiLibrary;
  /** Returns the per-chain ProxyResolver, or throws ChainNotReadyError if the chain context has not been materialised yet (R5). */
  proxyResolverFor: (chainId: string) => ProxyResolver;
  etherscanClient: EtherscanClientLike | null;
  logger: Logger;
}

export class ChainNotReadyError extends Error {
  constructor(chainId: string) {
    super(`Chain context not ready for chainId: ${chainId}`);
    this.name = 'ChainNotReadyError';
  }
}
