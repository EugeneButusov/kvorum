import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import fixture from '../../../tests/fixtures/abis/comp.json';
import { COMPOUND_COMP_TOKEN_TOPICS } from './events';

describe('comp-token topics', () => {
  it('matches vendored ABI fixture topic0 hashes', () => {
    const iface = new Interface(fixture);
    expect(COMPOUND_COMP_TOKEN_TOPICS.DelegateChanged).toBe(
      iface.getEvent('DelegateChanged')!.topicHash.toLowerCase(),
    );
    expect(COMPOUND_COMP_TOKEN_TOPICS.DelegateVotesChanged).toBe(
      iface.getEvent('DelegateVotesChanged')!.topicHash.toLowerCase(),
    );
  });
});
