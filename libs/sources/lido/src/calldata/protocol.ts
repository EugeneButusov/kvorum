import type { CalldataProtocolSupport } from '@sources/core';
import { loadAbiLibrary } from './abi-library';

/**
 * Bundled-ABI protocol for Lido `proposal_action` calldata. Owns the action rows for the EVMScript
 * tracks — `aragon_voting` (Aragon omnibus votes) and `easy_track` (motion-factory EVMScripts), which
 * share the same Agent/Lido target surface (`_reconcile` stripped defensively).
 */
export const lidoCalldataProtocol: CalldataProtocolSupport = {
  supportsSourceType(sourceType: string): boolean {
    const base = sourceType.replace(/_reconcile$/, '');
    return base === 'aragon_voting' || base === 'easy_track';
  },
  loadAbiLibrary,
};
