import { describe, expect, it } from 'vitest';
import {
  GOVERNOR_STATE_INTERFACE,
  GovernorStateDecodeError,
  TIMELOCK_INTERFACE,
  decodeGracePeriodResult,
  decodeStateResult,
  decodeTimelockResult,
  encodeGracePeriodCall,
  encodeStateCall,
  encodeTimelockCall,
  mapGovernorStateCode,
} from './governor-state';

describe('governor-state abi helpers', () => {
  it('encodes state(uint256) call data from source id', () => {
    expect(encodeStateCall('42')).toBe(GOVERNOR_STATE_INTERFACE.encodeFunctionData('state', [42n]));
  });

  it('decodes state(uint256) call result to numeric code', () => {
    const encodedResult = GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [3n]);
    expect(decodeStateResult(encodedResult)).toBe(3);
  });

  it('encodes timelock() call data', () => {
    expect(encodeTimelockCall()).toBe(GOVERNOR_STATE_INTERFACE.encodeFunctionData('timelock'));
  });

  it('decodes timelock() result to lowercased address', () => {
    const encodedResult = GOVERNOR_STATE_INTERFACE.encodeFunctionResult('timelock', [
      '0xc0dA01a04C3f3E0be433606045bB7017A7323E38',
    ]);
    expect(decodeTimelockResult(encodedResult)).toBe('0xc0da01a04c3f3e0be433606045bb7017a7323e38');
  });

  it('encodes GRACE_PERIOD() call data', () => {
    expect(encodeGracePeriodCall()).toBe(TIMELOCK_INTERFACE.encodeFunctionData('GRACE_PERIOD'));
  });

  it('decodes GRACE_PERIOD() result to seconds', () => {
    const encodedResult = TIMELOCK_INTERFACE.encodeFunctionResult('GRACE_PERIOD', [1209600n]);
    expect(decodeGracePeriodResult(encodedResult)).toBe(1209600);
  });

  it('maps governor state codes 0-7 to proposal states', () => {
    expect(mapGovernorStateCode(0)).toBe('pending');
    expect(mapGovernorStateCode(1)).toBe('active');
    expect(mapGovernorStateCode(2)).toBe('canceled');
    expect(mapGovernorStateCode(3)).toBe('defeated');
    expect(mapGovernorStateCode(4)).toBe('succeeded');
    expect(mapGovernorStateCode(5)).toBe('queued');
    expect(mapGovernorStateCode(6)).toBe('expired');
    expect(mapGovernorStateCode(7)).toBe('executed');
  });

  it('throws GovernorStateDecodeError for out-of-range state code', () => {
    expect(() => mapGovernorStateCode(8)).toThrow(GovernorStateDecodeError);
  });
});
