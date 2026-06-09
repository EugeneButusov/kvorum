import { describe, expect, it } from 'vitest';
import {
  aggregateSubmittedVotingPower,
  aggregateVotingPower,
  reconstructVotingPowerFromRawSlots,
} from './aggregate-power';

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

  it('reconstructs voting power from raw storage-slot values', () => {
    const aaveBaseBalance = encodeAaveLikeBaseBalanceSlot({
      balance: 50n,
      delegatedVotingPower: 3n,
      delegationMode: 0n,
    });
    const stkAaveBaseBalance = encodeAaveLikeBaseBalanceSlot({
      balance: 80n,
      delegatedVotingPower: 2n,
      delegationMode: 1n,
    });
    const aAaveBaseBalance = encodeAAaveBaseBalanceSlot({
      balance: 40n,
      delegationMode: 2n,
    });
    const aAaveDelegatedState = encodeAAaveDelegatedStateSlot({ delegatedVotingPower: 5n });

    expect(
      reconstructVotingPowerFromRawSlots({
        aaveBaseBalanceSlot: aaveBaseBalance,
        stkAaveBaseBalanceSlot: stkAaveBaseBalance,
        aAaveBaseBalanceSlot: aAaveBaseBalance,
        aAaveDelegatedStateSlot: aAaveDelegatedState,
        stkAaveSlashingExchangeRate: 2_000_000_000_000_000_000n,
      }),
    ).toBe(90_000_000_090n);
  });

  it('rejects a zero stkAave slashing exchange rate in raw reconstruction', () => {
    expect(() =>
      reconstructVotingPowerFromRawSlots({
        aaveBaseBalanceSlot: 0n,
        stkAaveBaseBalanceSlot: 0n,
        aAaveBaseBalanceSlot: 0n,
        aAaveDelegatedStateSlot: 0n,
        stkAaveSlashingExchangeRate: 0n,
      }),
    ).toThrow('stkAave slashing exchange rate must be non-zero');
  });
});

function encodeAaveLikeBaseBalanceSlot(args: {
  balance: bigint;
  delegatedVotingPower: bigint;
  delegationMode: bigint;
}): bigint {
  return args.balance | (args.delegatedVotingPower << 176n) | (args.delegationMode << 248n);
}

function encodeAAaveBaseBalanceSlot(args: { balance: bigint; delegationMode: bigint }): bigint {
  return args.balance | (args.delegationMode << 120n);
}

function encodeAAaveDelegatedStateSlot(args: { delegatedVotingPower: bigint }): bigint {
  return args.delegatedVotingPower << 72n;
}
