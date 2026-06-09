import { describe, expect, it } from 'vitest';
import { aggregateVotingPower } from './aggregate-power';

describe('aggregateVotingPower', () => {
  it('sums the three governance-power token reads', () => {
    expect(
      aggregateVotingPower({
        aave: 12n,
        stkAave: 34n,
        aAave: 56n,
      }),
    ).toBe(102n);
  });

  it('returns zero when every token read is zero', () => {
    expect(
      aggregateVotingPower({
        aave: 0n,
        stkAave: 0n,
        aAave: 0n,
      }),
    ).toBe(0n);
  });
});
