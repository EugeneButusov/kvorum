import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import { AAVE_GOVERNANCE_POWER_TYPE, AAVE_TOKEN_TOPICS } from './events';
import fixture from '../../../tests/fixtures/abis/aave-token.json';

describe('aave-token topics', () => {
  it('matches the vendored AaveTokenV3 ABI fixture topic0 for DelegateChanged', () => {
    const iface = new Interface(fixture);
    expect(AAVE_TOKEN_TOPICS.DelegateChanged).toBe(
      iface.getEvent('DelegateChanged')!.topicHash.toLowerCase(),
    );
  });

  it('exposes the GovernancePowerType enum values (VOTING=0, PROPOSITION=1)', () => {
    expect(AAVE_GOVERNANCE_POWER_TYPE).toEqual({ VOTING: 0, PROPOSITION: 1 });
  });
});
