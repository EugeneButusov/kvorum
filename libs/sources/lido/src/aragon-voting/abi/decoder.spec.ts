import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeAragonVotingLog } from './decoder';
import { ARAGON_VOTING_INTERFACE } from './events';

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'aragon_voting',
    chainId: '0x1',
    blockNumber: 20000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    txIndex: 0,
    logIndex: 0,
    address: '0x2e59a20f205bb85a89c53f1936454680651e618e',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

function encodeLog(eventName: string, args: unknown[]) {
  const fragment = ARAGON_VOTING_INTERFACE.getEvent(eventName)!;
  const encoded = ARAGON_VOTING_INTERFACE.encodeEventLog(fragment, args);
  return { topics: encoded.topics as string[], data: encoded.data };
}

const VOTER = '0x1111111111111111111111111111111111111111';
const CREATOR = '0x2222222222222222222222222222222222222222';

describe('decodeAragonVotingLog', () => {
  it('decodes StartVote', () => {
    const { topics, data } = encodeLog('StartVote', [1n, CREATOR, 'AIP-1: Initialize Lido DAO']);
    expect(decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toEqual({
      type: 'StartVote',
      payload: {
        voteId: '1',
        creator: CREATOR.toLowerCase(),
        metadata: 'AIP-1: Initialize Lido DAO',
      },
    });
  });

  it('decodes CastVote (yea)', () => {
    const { topics, data } = encodeLog('CastVote', [1n, VOTER, true, 5000000000000000000000n]);
    expect(decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toEqual({
      type: 'CastVote',
      payload: {
        voteId: '1',
        voter: VOTER.toLowerCase(),
        supports: true,
        stake: '5000000000000000000000',
      },
    });
  });

  it('decodes CastVote (nay)', () => {
    const { topics, data } = encodeLog('CastVote', [2n, VOTER, false, 1000000000000000000000n]);
    const result = decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting');
    expect(result.type).toBe('CastVote');
    if (result.type === 'CastVote') {
      expect(result.payload.supports).toBe(false);
      expect(result.payload.stake).toBe('1000000000000000000000');
    }
  });

  it('decodes CastObjection', () => {
    const { topics, data } = encodeLog('CastObjection', [2n, VOTER, 1000000000000000000000n]);
    expect(decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toEqual({
      type: 'CastObjection',
      payload: {
        voteId: '2',
        voter: VOTER.toLowerCase(),
        stake: '1000000000000000000000',
      },
    });
  });

  it('decodes ExecuteVote', () => {
    const { topics, data } = encodeLog('ExecuteVote', [42n]);
    expect(decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toEqual({
      type: 'ExecuteVote',
      payload: { voteId: '42' },
    });
  });

  it('decodes ChangeSupportRequired', () => {
    const pct = 500000000000000000n; // 0.5 * 10^18
    const { topics, data } = encodeLog('ChangeSupportRequired', [pct]);
    expect(decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toEqual({
      type: 'ChangeSupportRequired',
      payload: { supportRequiredPct: pct.toString() },
    });
  });

  it('decodes ChangeMinQuorum', () => {
    const pct = 50000000000000000n; // 0.05 * 10^18
    const { topics, data } = encodeLog('ChangeMinQuorum', [pct]);
    expect(decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toEqual({
      type: 'ChangeMinQuorum',
      payload: { minAcceptQuorumPct: pct.toString() },
    });
  });

  it('decodes ChangeVoteTime', () => {
    const { topics, data } = encodeLog('ChangeVoteTime', [259200n]); // 3 days
    expect(decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toEqual({
      type: 'ChangeVoteTime',
      payload: { voteTime: '259200' },
    });
  });

  it('decodes ChangeObjectionPhaseTime', () => {
    const { topics, data } = encodeLog('ChangeObjectionPhaseTime', [86400n]); // 1 day
    expect(decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toEqual({
      type: 'ChangeObjectionPhaseTime',
      payload: { objectionPhaseTime: '86400' },
    });
  });

  it('throws parse_failed on truncated data', () => {
    const { topics } = encodeLog('CastVote', [1n, VOTER, true, 5000n]);
    expect(() =>
      decodeAragonVotingLog(makeLog({ topics, data: '0x1234' }), 'aragon_voting'),
    ).toThrow(DecodeError);
    try {
      decodeAragonVotingLog(makeLog({ topics, data: '0x1234' }), 'aragon_voting');
    } catch (err) {
      expect((err as DecodeError).reason).toBe('parse_failed');
    }
  });

  it('throws unknown_topic when parseLog returns null', () => {
    vi.spyOn(ARAGON_VOTING_INTERFACE, 'parseLog').mockReturnValueOnce(null);
    const { topics, data } = encodeLog('ExecuteVote', [1n]);
    expect(() => decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toThrow(
      DecodeError,
    );
  });

  it('throws unknown_topic on foreign topic hash', () => {
    vi.spyOn(ARAGON_VOTING_INTERFACE, 'parseLog').mockReturnValueOnce({
      name: 'Transfer',
      fragment: { topicHash: '0x' + 'ff'.repeat(32) },
    } as never);
    const { topics, data } = encodeLog('ExecuteVote', [1n]);
    expect(() => decodeAragonVotingLog(makeLog({ topics, data }), 'aragon_voting')).toThrow(
      DecodeError,
    );
  });
});
