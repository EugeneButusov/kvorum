import { describe, expect, it } from 'vitest';
import {
  GOVERNOR_V2_STATE_INTERFACE,
  EXECUTOR_GRACE_PERIOD_INTERFACE,
  AaveGovernorV2StateDecodeError,
  encodeGetProposalByIdCall,
  decodeGetProposalByIdResult,
  deriveAaveV2State,
  encodeGracePeriodCall,
  decodeGracePeriodResult,
  type V2ProposalSummary,
} from './governor-state';

describe('encodeGetProposalByIdCall / decodeGetProposalByIdResult', () => {
  it('decodes the fields the reconciler needs from the full struct', () => {
    const encoded = GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalById', [
      [
        5n,
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
        [],
        [],
        [],
        [],
        [],
        11_500_000n,
        11_550_000n,
        1_800_000_000n,
        0n,
        0n,
        true,
        false,
        '0x3333333333333333333333333333333333333333',
        '0x' + '00'.repeat(32),
      ],
    ]);

    const result = decodeGetProposalByIdResult(encoded);
    expect(result.executor).toBe('0x2222222222222222222222222222222222222222');
    expect(result.executionTime).toBe(1_800_000_000n);
    expect(result.startBlock).toBe(11_500_000n);
    expect(result.endBlock).toBe(11_550_000n);
    expect(result.executed).toBe(true);
    expect(result.canceled).toBe(false);
  });

  it('lowercases executor address', () => {
    const encoded = GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalById', [
      [
        1n,
        '0x0000000000000000000000000000000000000001',
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
        [],
        [],
        [],
        [],
        [],
        0n,
        0n,
        0n,
        0n,
        0n,
        false,
        false,
        '0x0000000000000000000000000000000000000002',
        '0x' + '00'.repeat(32),
      ],
    ]);

    const result = decodeGetProposalByIdResult(encoded);
    expect(result.executor).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('throws AaveGovernorV2StateDecodeError on bad data', () => {
    expect(() => decodeGetProposalByIdResult('0xdeadbeef')).toThrow(AaveGovernorV2StateDecodeError);
  });

  it('encodeGetProposalByIdCall produces valid calldata', () => {
    const data = encodeGetProposalByIdCall('17');
    expect(data).toMatch(/^0x/);
  });
});

describe('encodeGracePeriodCall / decodeGracePeriodResult', () => {
  it('round-trips correctly', () => {
    const data = encodeGracePeriodCall();
    expect(data).toMatch(/^0x/);

    const encoded = EXECUTOR_GRACE_PERIOD_INTERFACE.encodeFunctionResult('GRACE_PERIOD', [86400n]);
    expect(decodeGracePeriodResult(encoded)).toBe(86400);
  });

  it('throws AaveGovernorV2StateDecodeError on bad data', () => {
    expect(() => decodeGracePeriodResult('0xdeadbeef')).toThrow(AaveGovernorV2StateDecodeError);
  });
});

describe('deriveAaveV2State', () => {
  function summary(over: Partial<V2ProposalSummary> = {}): V2ProposalSummary {
    return {
      executor: '0x' + 'ee'.repeat(20),
      executionTime: 0n,
      startBlock: 11_500_000n,
      endBlock: 11_550_000n,
      executed: false,
      canceled: false,
      ...over,
    };
  }
  const HEAD = 12_000_000n; // past endBlock

  it('canceled wins over everything', () => {
    expect(deriveAaveV2State(summary({ canceled: true, executed: true }), HEAD)).toEqual({
      kind: 'terminal',
      state: 'canceled',
    });
  });

  it('executed → executed', () => {
    expect(deriveAaveV2State(summary({ executed: true }), HEAD)).toEqual({
      kind: 'terminal',
      state: 'executed',
    });
  });

  it('head at or before startBlock → still pending', () => {
    expect(deriveAaveV2State(summary({ startBlock: 13_000_000n }), HEAD)).toEqual({
      kind: 'not_stale',
      state: 'pending',
    });
  });

  it('head within the voting window → still active', () => {
    expect(deriveAaveV2State(summary({ endBlock: 13_000_000n }), HEAD)).toEqual({
      kind: 'not_stale',
      state: 'active',
    });
  });

  it('concluded and never queued → defeated (the case getProposalState reverts on)', () => {
    // Real example: v2 #22 — executionTime 0, voting long over. getProposalState reverts; the
    // struct alone proves it never advanced to execution, so it is terminally defeated.
    expect(deriveAaveV2State(summary({ executionTime: 0n }), HEAD)).toEqual({
      kind: 'terminal',
      state: 'defeated',
    });
  });

  it('concluded and queued → awaiting_execution (caller decides expired vs queued)', () => {
    // Real example: v2 #45 — executionTime > 0, was queued, never executed.
    const s = summary({ executionTime: 1_636_763_579n, executor: '0x' + 'ab'.repeat(20) });
    expect(deriveAaveV2State(s, HEAD)).toEqual({
      kind: 'awaiting_execution',
      executionTime: 1_636_763_579n,
      executor: '0x' + 'ab'.repeat(20),
    });
  });
});
