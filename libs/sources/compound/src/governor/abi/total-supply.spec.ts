import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import { decodeTotalSupplyResult, encodeTotalSupplyCall } from './total-supply';

const ERC20 = new Interface(['function totalSupply() view returns (uint256)']);

describe('totalSupply ABI helpers', () => {
  it('encodes the known 4-byte selector', () => {
    expect(encodeTotalSupplyCall()).toBe('0x18160ddd');
  });

  it('round-trips a known value', () => {
    const encoded = ERC20.encodeFunctionResult('totalSupply', [10_000_000n * 10n ** 18n]);
    expect(decodeTotalSupplyResult(encoded)).toBe(10_000_000n * 10n ** 18n);
  });
});
