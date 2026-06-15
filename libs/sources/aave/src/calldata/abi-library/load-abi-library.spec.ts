import { ethers } from 'ethers';
import { describe, expect, it } from 'vitest';
import { loadAbiLibrary } from './load-abi-library';

function sel(sig: string): string {
  return ethers.id(sig).slice(0, 10);
}

describe('loadAbiLibrary', () => {
  it('returns a non-empty bySelector map', () => {
    const lib = loadAbiLibrary();
    expect(lib.bySelector.size).toBeGreaterThan(0);
  });

  it('is memoized', () => {
    expect(loadAbiLibrary()).toBe(loadAbiLibrary());
  });

  it('keeps selector keys aligned with their fragments', () => {
    const lib = loadAbiLibrary();

    for (const [selector, bucket] of lib.bySelector) {
      for (const entry of bucket) {
        expect(entry.fragment.selector.toLowerCase()).toBe(selector);
      }
    }
  });

  it('loads without selector collisions', () => {
    const lib = loadAbiLibrary();

    for (const [selector, bucket] of lib.bySelector) {
      expect(bucket, selector).toHaveLength(1);
    }
  });

  it('loads v2 LendingPoolConfigurator distinct selectors', () => {
    const lib = loadAbiLibrary();
    expect(lib.bySelector.get(sel('enableBorrowingOnReserve(address,bool)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('disableBorrowingOnReserve(address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('freezeReserve(address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('unfreezeReserve(address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('activateReserve(address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('deactivateReserve(address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('setPoolPause(bool)'))).toHaveLength(1);
  });

  it('loads v2 LendingPoolAddressesProvider selectors', () => {
    const lib = loadAbiLibrary();
    expect(lib.bySelector.get(sel('setPriceOracle(address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('setLendingRateOracle(address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('setAddress(bytes32,address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('setAddressAsProxy(bytes32,address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('setLendingPoolImpl(address)'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('setEmergencyAdmin(address)'))).toHaveLength(1);
  });

  it('loads AaveGovernanceV2 admin selectors', () => {
    const lib = loadAbiLibrary();
    expect(lib.bySelector.get(sel('authorizeExecutors(address[])'))).toHaveLength(1);
    expect(lib.bySelector.get(sel('setVotingDelay(uint256)'))).toHaveLength(1);
  });

  it('loads stkAAVE selectors', () => {
    const lib = loadAbiLibrary();
    expect(lib.bySelector.get(sel('setDistributionEnd(uint256)'))).toHaveLength(1);
  });
});
