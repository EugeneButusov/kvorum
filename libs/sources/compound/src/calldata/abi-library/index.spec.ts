import { FunctionFragment } from 'ethers';
import { describe, expect, it } from 'vitest';
import { loadAbiLibrary } from './index';

describe('loadAbiLibrary', () => {
  it('returns a non-empty bySelector map', () => {
    const lib = loadAbiLibrary();
    expect(lib.bySelector.size).toBeGreaterThan(0);
  });

  it('is memoized — returns the same object on repeated calls', () => {
    expect(loadAbiLibrary()).toBe(loadAbiLibrary());
  });

  it('transfer(address,uint256) resolves to at least the erc20 entry', () => {
    const lib = loadAbiLibrary();
    const transferSelector = FunctionFragment.from(
      'transfer(address,uint256)',
    ).selector.toLowerCase();
    const bucket = lib.bySelector.get(transferSelector);
    expect(bucket).toBeDefined();
    expect(bucket!.some((e) => e.sourceName === 'erc20')).toBe(true);
  });

  it('transferFrom(address,address,uint256) is in the erc20 library', () => {
    const lib = loadAbiLibrary();
    const sel = FunctionFragment.from(
      'transferFrom(address,address,uint256)',
    ).selector.toLowerCase();
    const bucket = lib.bySelector.get(sel);
    expect(bucket).toBeDefined();
    expect(bucket!.some((e) => e.sourceName === 'erc20')).toBe(true);
  });

  it('named-param round-trip: FunctionFragment.from with named params gives the canonical selector', () => {
    // Regression for the named-param hashing bug: transfer(address to, uint256 amount)
    // must produce the same selector as transfer(address,uint256).
    const withNames = FunctionFragment.from('transfer(address to, uint256 amount)').selector;
    const canonical = FunctionFragment.from('transfer(address,uint256)').selector;
    expect(withNames).toBe(canonical);
  });

  it('each entry in bySelector has matching selector on its fragment', () => {
    const lib = loadAbiLibrary();
    for (const [selector, bucket] of lib.bySelector) {
      for (const entry of bucket) {
        expect(
          entry.fragment.selector.toLowerCase(),
          `fragment selector mismatch in ${entry.sourceName}`,
        ).toBe(selector);
      }
    }
  });
});
