import { describe, expect, it } from 'vitest';
import {
  AaveGovernanceStateDecodeError,
  GOVERNANCE_STATE_INTERFACE,
  decodeExpirationTimeResult,
  decodeProposalStateResult,
  encodeExpirationTimeCall,
  encodeGetProposalStateCall,
  mapAaveStateCode,
} from './governance-state';

describe('aave governance-state abi helpers', () => {
  it('encodes getProposalState(uint256) call data from source id', () => {
    expect(encodeGetProposalStateCall('42')).toBe(
      GOVERNANCE_STATE_INTERFACE.encodeFunctionData('getProposalState', [42n]),
    );
  });

  it('decodes getProposalState(uint256) call result to numeric code', () => {
    const encodedResult = GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('getProposalState', [7n]);
    expect(decodeProposalStateResult(encodedResult)).toBe(7);
  });

  it('encodes PROPOSAL_EXPIRATION_TIME() call data', () => {
    expect(encodeExpirationTimeCall()).toBe(
      GOVERNANCE_STATE_INTERFACE.encodeFunctionData('PROPOSAL_EXPIRATION_TIME'),
    );
  });

  it('decodes PROPOSAL_EXPIRATION_TIME() result to seconds', () => {
    const encodedResult = GOVERNANCE_STATE_INTERFACE.encodeFunctionResult(
      'PROPOSAL_EXPIRATION_TIME',
      [86400n],
    );
    expect(decodeExpirationTimeResult(encodedResult)).toBe(86400);
  });

  it('maps Aave governance state codes to proposal states', () => {
    expect(mapAaveStateCode(1)).toBe('pending');
    expect(mapAaveStateCode(2)).toBe('active');
    expect(mapAaveStateCode(3)).toBe('queued');
    expect(mapAaveStateCode(4)).toBe('executed');
    expect(mapAaveStateCode(5)).toBe('defeated');
    expect(mapAaveStateCode(6)).toBe('canceled');
    expect(mapAaveStateCode(7)).toBe('expired');
  });

  it('throws for Null and out-of-range state codes', () => {
    expect(() => mapAaveStateCode(0)).toThrow(AaveGovernanceStateDecodeError);
    expect(() => mapAaveStateCode(8)).toThrow(AaveGovernanceStateDecodeError);
  });
});
