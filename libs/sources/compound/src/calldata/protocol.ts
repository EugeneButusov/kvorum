import type { CalldataProtocolSupport } from '@sources/core';
import { loadAbiLibrary } from './abi-library';
import { decodeByHeuristic } from './heuristics';

export const compoundCalldataProtocol: CalldataProtocolSupport = {
  supportsSourceType(sourceType: string): boolean {
    return sourceType.replace(/_reconcile$/, '').startsWith('compound_');
  },
  loadAbiLibrary,
  decodeByHeuristic,
};
