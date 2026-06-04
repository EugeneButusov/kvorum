import type { CalldataProtocolSupport } from '@sources/core';
import { loadAbiLibrary } from './abi-library';

export const aaveCalldataProtocol: CalldataProtocolSupport = {
  supportsSourceType(sourceType: string): boolean {
    return sourceType.replace(/_reconcile$/, '').startsWith('aave_');
  },
  loadAbiLibrary,
};
