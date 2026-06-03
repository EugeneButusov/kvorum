// ABI sources: ERC-20 (public domain), OpenZeppelin MIT, Aave interfaces under vendor-compatible upstream licenses.
import { FunctionFragment, Interface } from 'ethers';
import { ERC20_ABI, OZ_ACCESS_CONTROL_ABI, OZ_GOVERNOR_ABI } from '@sources/core';
import type { AbiEntry, LoadedAbiLibrary } from '@sources/core';
import aaveAclManager from './aave-acl-manager.json' with { type: 'json' };
import aaveCollector from './aave-collector.json' with { type: 'json' };
import aaveExecutor from './aave-executor.json' with { type: 'json' };
import aavePayloadsController from './aave-payloads-controller.json' with { type: 'json' };
import aavePoolConfigurator from './aave-pool-configurator.json' with { type: 'json' };
import aaveToken from './aave-token.json' with { type: 'json' };
import aaveVotingStrategy from './aave-voting-strategy.json' with { type: 'json' };

const SOURCES = [
  { name: 'erc20', abi: ERC20_ABI },
  { name: 'oz-access-control', abi: OZ_ACCESS_CONTROL_ABI },
  { name: 'oz-governor', abi: OZ_GOVERNOR_ABI },
  { name: 'aave-acl-manager', abi: aaveAclManager },
  { name: 'aave-collector', abi: aaveCollector },
  { name: 'aave-executor', abi: aaveExecutor },
  { name: 'aave-payloads-controller', abi: aavePayloadsController },
  { name: 'aave-pool-configurator', abi: aavePoolConfigurator },
  { name: 'aave-token', abi: aaveToken },
  { name: 'aave-voting-strategy', abi: aaveVotingStrategy },
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
      const selector = fn.selector.toLowerCase();
      const bucket = bySelector.get(selector) ?? [];
      bucket.push({ iface, fragment: fn, sourceName: name });
      bySelector.set(selector, bucket);
    }
  }

  cachedLibrary = { bySelector };
  return cachedLibrary;
}
