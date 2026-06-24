import type { CalldataProtocolSupport } from '@sources/core';
import { loadAbiLibrary } from './abi-library';

/**
 * Bundled-ABI protocol for Lido Aragon `proposal_action` calldata. Exact-match on
 * `aragon_voting` (the source_type that owns the action rows; `_reconcile` stripped
 * defensively). Easy Track / future Aragon source_types will extend this predicate.
 */
export const lidoCalldataProtocol: CalldataProtocolSupport = {
  supportsSourceType(sourceType: string): boolean {
    return sourceType.replace(/_reconcile$/, '') === 'aragon_voting';
  },
  loadAbiLibrary,
};
