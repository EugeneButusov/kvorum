import { describe, expect, it } from 'vitest';
import {
  GOVERNOR_V2_STATE_INTERFACE,
  EXECUTOR_GRACE_PERIOD_INTERFACE,
  AaveGovernorV2StateDecodeError,
  encodeGetProposalStateCall,
  decodeProposalStateResult,
  encodeGetProposalByIdCall,
  decodeGetProposalByIdResult,
  encodeGracePeriodCall,
  decodeGracePeriodResult,
  mapAaveV2StateCode,
} from './governor-state';

describe('encodeGetProposalStateCall / decodeProposalStateResult', () => {
  it('round-trips correctly', () => {
    const data = encodeGetProposalStateCall('42');
    const encoded = GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [2n]);
    expect(decodeProposalStateResult(encoded)).toBe(2);
    expect(data).toMatch(/^0x/);
  });

  it('throws AaveGovernorV2StateDecodeError on bad data', () => {
    expect(() => decodeProposalStateResult('0xdeadbeef')).toThrow(AaveGovernorV2StateDecodeError);
  });
});

describe('encodeGetProposalByIdCall / decodeGetProposalByIdResult', () => {
  it('decodes executor and executionTime from full struct', () => {
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
        0n,
        0n,
        1_800_000_000n,
        0n,
        0n,
        false,
        false,
        '0x3333333333333333333333333333333333333333',
        '0x' + '00'.repeat(32),
      ],
    ]);

    const result = decodeGetProposalByIdResult(encoded);
    expect(result.executor).toBe('0x2222222222222222222222222222222222222222');
    expect(result.executionTime).toBe(1_800_000_000n);
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

describe('mapAaveV2StateCode', () => {
  const cases: [number, string][] = [
    [0, 'pending'],
    [1, 'canceled'],
    [2, 'active'],
    [3, 'defeated'],
    [4, 'succeeded'],
    [5, 'queued'],
    [6, 'expired'],
    [7, 'executed'],
  ];

  it.each(cases)('maps code %i to %s', (code, expected) => {
    expect(mapAaveV2StateCode(code)).toBe(expected);
  });

  it('throws on unknown state code', () => {
    expect(() => mapAaveV2StateCode(99)).toThrow(AaveGovernorV2StateDecodeError);
  });
});
