// ABI sources: ERC-20 (public domain), OpenZeppelin MIT, Compound BSD-3-Clause.
// Standard interface ABIs are not copyrightable; project-specific ABIs sourced
// from their canonical open-source repositories.
import { Interface, FunctionFragment } from 'ethers';
import compoundComptroller from './compound-comptroller.json' with { type: 'json' };
import compoundCtoken from './compound-ctoken.json' with { type: 'json' };
import compoundGovernorBravo from './compound-governor-bravo.json' with { type: 'json' };
import erc20 from './erc20.json' with { type: 'json' };
import ozAccessControl from './oz-access-control.json' with { type: 'json' };
import ozGovernor from './oz-governor.json' with { type: 'json' };

export interface AbiEntry {
  iface: Interface;
  fragment: FunctionFragment;
  sourceName: string;
}

export interface LoadedAbiLibrary {
  /** selector (lowercase, with 0x prefix) → list of candidate entries (collision-safe). */
  bySelector: ReadonlyMap<string, readonly AbiEntry[]>;
}

const SOURCES = [
  { name: 'erc20', abi: erc20 },
  { name: 'oz-access-control', abi: ozAccessControl },
  { name: 'oz-governor', abi: ozGovernor },
  { name: 'compound-comptroller', abi: compoundComptroller },
  { name: 'compound-ctoken', abi: compoundCtoken },
  { name: 'compound-governor-bravo', abi: compoundGovernorBravo },
] as const;

let cachedLibrary: LoadedAbiLibrary | undefined;

export function loadAbiLibrary(): LoadedAbiLibrary {
  if (cachedLibrary !== undefined) return cachedLibrary;

  const bySelector = new Map<string, AbiEntry[]>();

  for (const { name, abi } of SOURCES) {
    const iface = new Interface(abi as never[]);
    for (const fragment of iface.fragments) {
      if (fragment.type !== 'function') continue;
      const fn = fragment as FunctionFragment;
      // Read selector directly from the fragment — never round-trip through
      // iface.getFunction(format()) which throws on overload ambiguity.
      const selector = fn.selector.toLowerCase();
      const bucket = bySelector.get(selector) ?? [];
      bucket.push({ iface, fragment: fn, sourceName: name });
      bySelector.set(selector, bucket);
    }
  }

  cachedLibrary = { bySelector };
  return cachedLibrary;
}
