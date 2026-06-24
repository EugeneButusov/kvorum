import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import { lidoCalldataProtocol } from './protocol';

describe('lidoCalldataProtocol', () => {
  it('supports aragon_voting (and the _reconcile alias), not other sources', () => {
    expect(lidoCalldataProtocol.supportsSourceType('aragon_voting')).toBe(true);
    expect(lidoCalldataProtocol.supportsSourceType('aragon_voting_reconcile')).toBe(true);
    expect(lidoCalldataProtocol.supportsSourceType('aave_governance_v3')).toBe(false);
    expect(lidoCalldataProtocol.supportsSourceType('compound_governor_bravo')).toBe(false);
  });

  it('loads an ABI library indexing the Aragon-core selectors', () => {
    const lib = lidoCalldataProtocol.loadAbiLibrary();
    expect(lib.bySelector.size).toBeGreaterThan(0);

    const acl = new Interface(['function grantPermission(address,address,bytes32)']);
    const grantSelector = acl.getFunction('grantPermission')!.selector.toLowerCase();
    expect(lib.bySelector.has(grantSelector)).toBe(true);

    const agent = new Interface(['function execute(address,uint256,bytes)']);
    const executeSelector = agent.getFunction('execute')!.selector.toLowerCase();
    expect(lib.bySelector.has(executeSelector)).toBe(true);

    // shared ERC20 reused for LDO/stETH
    const erc20 = new Interface(['function transfer(address,uint256)']);
    expect(lib.bySelector.has(erc20.getFunction('transfer')!.selector.toLowerCase())).toBe(true);
  });

  it('memoizes the loaded library', () => {
    expect(lidoCalldataProtocol.loadAbiLibrary()).toBe(lidoCalldataProtocol.loadAbiLibrary());
  });
});
