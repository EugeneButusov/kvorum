import { describe, expect, it } from 'vitest';
import { ARAGON_VOTING_INTERFACE, ARAGON_VOTING_TOPICS } from './events';

describe('ARAGON_VOTING_TOPICS', () => {
  const events = [
    'StartVote',
    'CastVote',
    'CastObjection',
    'ExecuteVote',
    'ChangeSupportRequired',
    'ChangeMinQuorum',
    'ChangeVoteTime',
    'ChangeObjectionPhaseTime',
  ] as const;

  it('has 8 unique topic hashes', () => {
    const hashes = Object.values(ARAGON_VOTING_TOPICS);
    expect(hashes).toHaveLength(8);
    expect(new Set(hashes).size).toBe(8);
  });

  it.each(events)('%s topic matches the interface fragment', (name) => {
    const fragment = ARAGON_VOTING_INTERFACE.getEvent(name);
    expect(fragment).not.toBeNull();
    expect(ARAGON_VOTING_TOPICS[name]).toBe(fragment!.topicHash.toLowerCase());
  });

  it('all topics start with 0x and are 66 chars', () => {
    for (const hash of Object.values(ARAGON_VOTING_TOPICS)) {
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
