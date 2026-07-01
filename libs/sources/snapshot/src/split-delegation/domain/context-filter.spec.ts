import { describe, expect, it } from 'vitest';
import { isTrackedSplitDelegation } from './context-filter';
import type { SplitDelegationEvent } from './types';

function clearedFor(context: string): SplitDelegationEvent {
  return { type: 'DelegationCleared', payload: { account: `0x${'11'.repeat(20)}`, context } };
}

describe('isTrackedSplitDelegation', () => {
  it('accepts seeded spaces', () => {
    expect(isTrackedSplitDelegation(clearedFor('lido-snapshot.eth'))).toBe(true);
    expect(isTrackedSplitDelegation(clearedFor('aavedao.eth'))).toBe(true);
    expect(isTrackedSplitDelegation(clearedFor('comp-vote.eth'))).toBe(true);
  });

  it('rejects unseeded spaces', () => {
    expect(isTrackedSplitDelegation(clearedFor('someother.eth'))).toBe(false);
    expect(isTrackedSplitDelegation(clearedFor(''))).toBe(false);
  });
});
