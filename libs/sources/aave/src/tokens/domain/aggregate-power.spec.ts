import { describe, expect, it } from 'vitest';
import { aggregateSubmittedVotingPower, aggregateVotingPower } from './aggregate-power';

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

  it('sums only the submitted governance assets', () => {
    expect(
      aggregateSubmittedVotingPower(
        {
          aave: 12n,
          stkAave: 34n,
          aAave: 56n,
        },
        [
          '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
          '0xA700b4eB416Be35b2911fd5Dee80678ff64fF6C9',
        ],
      ),
    ).toBe(68n);
  });

  it('rejects unsupported submitted assets', () => {
    expect(() =>
      aggregateSubmittedVotingPower(
        {
          aave: 12n,
          stkAave: 34n,
          aAave: 56n,
        },
        ['0x0000000000000000000000000000000000000001'],
      ),
    ).toThrow('unsupported Aave voting asset');
  });
});
