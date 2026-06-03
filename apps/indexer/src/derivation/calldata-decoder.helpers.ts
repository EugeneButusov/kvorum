import { aaveCalldataProtocol } from '@sources/aave';
import { compoundCalldataProtocol } from '@sources/compound';
import {
  type CalldataProtocolSupport,
  type HeuristicResult,
  type LoadedAbiLibrary,
  loadSharedAbiLibrary,
} from '@sources/core';

const protocols: readonly CalldataProtocolSupport[] = [
  aaveCalldataProtocol,
  compoundCalldataProtocol,
];

export const bundledAbisFor = makeBundledAbiResolver(protocols);
export const decodeByHeuristic = makeHeuristicDecoder(protocols);

export function makeBundledAbiResolver(
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

export function makeHeuristicDecoder(
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
