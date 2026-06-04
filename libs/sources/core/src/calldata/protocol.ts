import type { LoadedAbiLibrary } from './abi-library';
import type { HeuristicResult } from './types';

export interface CalldataProtocolSupport {
  supportsSourceType(sourceType: string): boolean;
  loadAbiLibrary(): LoadedAbiLibrary;
  decodeByHeuristic?: (calldata: string) => HeuristicResult | null;
}
