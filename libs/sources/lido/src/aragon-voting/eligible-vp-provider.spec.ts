import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { aragonEligibleVpProvider } from './eligible-vp-provider';

const GET_VOTE_IFACE = new Interface([
  'function getVote(uint256) view returns (bool, bool, uint64, uint64, uint64, uint64, uint256, uint256, uint256, bytes, uint8)',
]);

function encodeGetVote(votingPower: bigint): string {
  return GET_VOTE_IFACE.encodeFunctionResult('getVote', [
    true,
    false,
    1700000000,
    18000000,
    500000000000000000n,
    250000000000000000n,
    3_000_000n * 10n ** 18n,
    1_000_000n * 10n ** 18n,
    votingPower,
    '0x',
    0,
  ]);
}

describe('aragonEligibleVpProvider', () => {
  it('declares aragon_voting source type', () => {
    expect(aragonEligibleVpProvider.sourceTypes).toEqual(['aragon_voting']);
  });

  it('fetches getVote at latest and extracts votingPower', async () => {
    const vp = 5_000_000n * 10n ** 18n;
    const send = vi.fn().mockResolvedValue(encodeGetVote(vp));

    const result = await aragonEligibleVpProvider.fetchEligibleVp(
      {
        sourceId: '180',
        votingStartsBlock: '18000000',
        primaryTokenAddress: '0xToken',
        votingAddress: '0xVoting',
        votingStrategyAddress: null,
      },
      send,
    );

    expect(result).toBe(vp);
    expect(send).toHaveBeenCalledWith('eth_call', [
      { to: '0xVoting', data: expect.any(String) },
      'latest',
    ]);
  });

  it('returns null when votingAddress is null', async () => {
    const send = vi.fn();
    const result = await aragonEligibleVpProvider.fetchEligibleVp(
      {
        sourceId: '180',
        votingStartsBlock: '18000000',
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
