import { describe, expect, it, vi } from 'vitest';
import { GOVERNANCE_STRATEGY_INTERFACE } from './abi/governance-strategy';
import { aaveV2EligibleVpProvider } from './eligible-vp-provider';

function encodeSupply(value: bigint): string {
  return GOVERNANCE_STRATEGY_INTERFACE.encodeFunctionResult('getTotalVotingSupplyAt', [value]);
}

describe('aaveV2EligibleVpProvider', () => {
  it('declares aave_governor_v2 source type', () => {
    expect(aaveV2EligibleVpProvider.sourceTypes).toEqual(['aave_governor_v2']);
  });

  it('fetches getTotalVotingSupplyAt at votingStartsBlock', async () => {
    const vp = 16_000_000n * 10n ** 18n;
    const send = vi.fn().mockResolvedValue(encodeSupply(vp));

    const result = await aaveV2EligibleVpProvider.fetchEligibleVp(
      {
        sourceId: '1',
        votingStartsBlock: '19500000',
        primaryTokenAddress: '0xToken',
        votingAddress: null,
        votingStrategyAddress: '0xStrategy',
      },
      send,
    );

    expect(result).toBe(vp);
    expect(send).toHaveBeenCalledWith('eth_call', [
      { to: '0xStrategy', data: expect.any(String) },
      `0x${BigInt('19500000').toString(16)}`,
    ]);
  });

  it('returns null when votingStartsBlock is null', async () => {
    const send = vi.fn();
    const result = await aaveV2EligibleVpProvider.fetchEligibleVp(
      {
        sourceId: '1',
        votingStartsBlock: null,
        primaryTokenAddress: '0xToken',
        votingAddress: null,
        votingStrategyAddress: '0xStrategy',
      },
      send,
    );

    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns null when votingStrategyAddress is null', async () => {
    const send = vi.fn();
    const result = await aaveV2EligibleVpProvider.fetchEligibleVp(
      {
        sourceId: '1',
        votingStartsBlock: '19500000',
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
