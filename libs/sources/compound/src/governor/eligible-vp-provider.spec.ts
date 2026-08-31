import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { compoundEligibleVpProvider } from './eligible-vp-provider';

const ERC20 = new Interface(['function totalSupply() view returns (uint256)']);

function encodeTotalSupply(value: bigint): string {
  return ERC20.encodeFunctionResult('totalSupply', [value]);
}

describe('compoundEligibleVpProvider', () => {
  it('declares compound governor source types', () => {
    expect(compoundEligibleVpProvider.sourceTypes).toEqual([
      'compound_governor_bravo',
      'compound_governor_alpha',
      'compound_governor_oz',
    ]);
  });

  it('fetches totalSupply at votingStartsBlock', async () => {
    const vp = 10_000_000n * 10n ** 18n;
    const send = vi.fn().mockResolvedValue(encodeTotalSupply(vp));

    const result = await compoundEligibleVpProvider.fetchEligibleVp(
      {
        sourceId: '1',
        votingStartsBlock: '18000000',
        primaryTokenAddress: '0xToken',
        votingAddress: null,
        votingStrategyAddress: null,
      },
      send,
    );

    expect(result).toBe(vp);
    expect(send).toHaveBeenCalledWith('eth_call', [
      { to: '0xToken', data: expect.any(String) },
      `0x${BigInt('18000000').toString(16)}`,
    ]);
  });

  it('returns null when votingStartsBlock is null', async () => {
    const send = vi.fn();
    const result = await compoundEligibleVpProvider.fetchEligibleVp(
      {
        sourceId: '1',
        votingStartsBlock: null,
        primaryTokenAddress: '0xToken',
        votingAddress: null,
        votingStrategyAddress: null,
      },
      send,
    );

    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
