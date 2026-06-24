// ABI sources: ERC-20 (public domain), OpenZeppelin MIT, Aragon apps (AGPL upstream,
// vendored signatures only), Lido contracts (GPL/MIT upstream, signatures only).
import { FunctionFragment, Interface } from 'ethers';
import { ERC20_ABI, OZ_ACCESS_CONTROL_ABI } from '@sources/core';
import type { AbiEntry, LoadedAbiLibrary } from '@sources/core';
import aragonAcl from './aragon-acl.json' with { type: 'json' };
import aragonAgent from './aragon-agent.json' with { type: 'json' };
import aragonFinance from './aragon-finance.json' with { type: 'json' };
import aragonKernel from './aragon-kernel.json' with { type: 'json' };
import aragonTokenManager from './aragon-token-manager.json' with { type: 'json' };
import aragonVoting from './aragon-voting.json' with { type: 'json' };
import lidoCommon from './lido-common.json' with { type: 'json' };

// First curated set: Aragon-core apps (exact, high-frequency in omnibuses) + reused
// shared ERC20 (LDO/stETH) + OZ AccessControl (Lido V2 grantRole/revokeRole on
// StakingRouter / WithdrawalQueue / oracles / Burner). The ≥95% omnibus-hit-rate
// sweep (NodeOperatorsRegistry / StakingRouter / Easy Track factory selectors) is a
// tracked follow-up.
const SOURCES = [
  { name: 'erc20', abi: ERC20_ABI },
  { name: 'oz-access-control', abi: OZ_ACCESS_CONTROL_ABI },
  { name: 'aragon-acl', abi: aragonAcl },
  { name: 'aragon-agent', abi: aragonAgent },
  { name: 'aragon-finance', abi: aragonFinance },
  { name: 'aragon-kernel', abi: aragonKernel },
  { name: 'aragon-token-manager', abi: aragonTokenManager },
  { name: 'aragon-voting', abi: aragonVoting },
  { name: 'lido-common', abi: lidoCommon },
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
