// ABI sources: ERC-20 (public domain), OpenZeppelin MIT.
// Standard interface ABIs are not copyrightable; sourced from their canonical
// open-source repositories. Kept here so any source package can reference them
// without duplicating the JSON.
import { Interface, FunctionFragment } from 'ethers';
import { ERC20_ABI, OZ_ACCESS_CONTROL_ABI, OZ_GOVERNOR_ABI } from './abi-constants';
import type { AbiEntry, LoadedAbiLibrary } from '../calldata/abi-library';

const SHARED_SOURCES = [
  { name: 'erc20', abi: ERC20_ABI },
  { name: 'oz-access-control', abi: OZ_ACCESS_CONTROL_ABI },
  { name: 'oz-governor', abi: OZ_GOVERNOR_ABI },
] as const;

let cachedSharedAbiLibrary: LoadedAbiLibrary | undefined;

export function loadSharedAbiLibrary(): LoadedAbiLibrary {
  if (cachedSharedAbiLibrary !== undefined) return cachedSharedAbiLibrary;

  const bySelector = new Map<string, AbiEntry[]>();

  for (const { name, abi } of SHARED_SOURCES) {
    const iface = new Interface(abi as never[]);
    for (const fragment of iface.fragments) {
      if (fragment.type !== 'function') continue;
      const fn = fragment as FunctionFragment;
      const selector = fn.selector.toLowerCase();
      const bucket = bySelector.get(selector) ?? [];
      bucket.push({ iface, fragment: fn, sourceName: name });
      bySelector.set(selector, bucket);
    }
  }

  cachedSharedAbiLibrary = { bySelector };
  return cachedSharedAbiLibrary;
}
