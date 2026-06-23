import { describe, expect, it } from 'vitest';
import { LidoAragonVotingActorAddressDeriver } from './actor-address-deriver';
import { AragonVotingArchivePayloadRepository } from '../persistence/archive-payload-repository';

// Payload repo is unused by extractAddresses; pass a stub.
const deriver = new LidoAragonVotingActorAddressDeriver(
  new AragonVotingArchivePayloadRepository(null as never),
);

const CREATOR = '0xAbC0000000000000000000000000000000000001';
const VOTER = '0xDeF0000000000000000000000000000000000002';

describe('LidoAragonVotingActorAddressDeriver', () => {
  it('enumerates every projectable event type so state/config rows pass the gate', () => {
    expect([...deriver.eventTypes]).toEqual([
      'StartVote',
      'CastVote',
      'CastObjection',
      'ExecuteVote',
      'ChangeSupportRequired',
      'ChangeMinQuorum',
      'ChangeVoteTime',
      'ChangeObjectionPhaseTime',
    ]);
  });

  it('extracts the creator (lowercased) from StartVote as proposer_event', () => {
    expect(
      deriver.extractAddresses(
        'StartVote',
        JSON.stringify({ voteId: '1', creator: CREATOR, metadata: 'x' }),
      ),
    ).toEqual([{ address: CREATOR.toLowerCase(), source: 'proposer_event' }]);
  });

  it('extracts the voter from CastVote and CastObjection as voter_event', () => {
    expect(
      deriver.extractAddresses(
        'CastVote',
        JSON.stringify({ voteId: '1', voter: VOTER, supports: true, stake: '1' }),
      ),
    ).toEqual([{ address: VOTER.toLowerCase(), source: 'voter_event' }]);
    expect(
      deriver.extractAddresses(
        'CastObjection',
        JSON.stringify({ voteId: '1', voter: VOTER, stake: '1' }),
      ),
    ).toEqual([{ address: VOTER.toLowerCase(), source: 'voter_event' }]);
  });

  it('returns [] for no-actor events (ExecuteVote + all Change*)', () => {
    for (const eventType of [
      'ExecuteVote',
      'ChangeSupportRequired',
      'ChangeMinQuorum',
      'ChangeVoteTime',
      'ChangeObjectionPhaseTime',
    ] as const) {
      expect(deriver.extractAddresses(eventType, JSON.stringify({ voteId: '1' }))).toEqual([]);
    }
  });

  it('throws on a malformed address payload', () => {
    expect(() =>
      deriver.extractAddresses(
        'StartVote',
        JSON.stringify({ voteId: '1', creator: 'nope', metadata: 'x' }),
      ),
    ).toThrow();
  });
});
