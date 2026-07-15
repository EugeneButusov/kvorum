import { describe, expect, it } from 'vitest';
import { shareOf, toDelegateLeaderboardRowDto } from './delegate-leaderboard.mappers';

describe('shareOf', () => {
  it('computes the fractional share to 4 decimals', () => {
    expect(shareOf('150', '600')).toBe(0.25);
    expect(shareOf('1', '3')).toBe(0.3333);
  });

  it('handles a zero or missing total without dividing by zero', () => {
    expect(shareOf('100', '0')).toBe(0);
  });

  it('works with UInt256-scale values (BigInt, no float overflow)', () => {
    const power = (427n * 10n ** 18n).toString();
    const total = (1000n * 10n ** 18n).toString();
    expect(shareOf(power, total)).toBe(0.427);
  });
});

describe('toDelegateLeaderboardRowDto', () => {
  it('joins the ranked row with its actor identity and share', () => {
    const dto = toDelegateLeaderboardRowDto(
      { actor_id: 'a1', voting_power: '150', delegator_count: 2 },
      1,
      '600',
      { primary_address: '0xabc', display_name: 'a16z' },
    );
    expect(dto).toEqual({
      rank: 1,
      actor_id: 'a1',
      address: '0xabc',
      display_name: 'a16z',
      voting_power: '150',
      voting_power_share: 0.25,
      delegator_count: 2,
    });
  });

  it('degrades gracefully when the actor identity is missing', () => {
    const dto = toDelegateLeaderboardRowDto(
      { actor_id: 'a2', voting_power: '0', delegator_count: 0 },
      2,
      '600',
      undefined,
    );
    expect(dto.address).toBe('');
    expect(dto.display_name).toBeNull();
    expect(dto.voting_power_share).toBe(0);
  });
});
