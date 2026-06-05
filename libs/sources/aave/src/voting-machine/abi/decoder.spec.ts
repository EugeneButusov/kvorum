import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeAaveVotingMachineLog } from './decoder';
import { AAVE_VOTING_MACHINE_INTERFACE } from './events';

function loadFixture(name: string): { topics: string[]; data: string } {
  const path = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'logs', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as { topics: string[]; data: string };
}

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'aave_voting_machine',
    chainId: '0x89',
    blockNumber: 69000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    txIndex: 0,
    logIndex: 0,
    address: '0x44c8b753229006a8047a05b90379a7e92185e97c',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

describe('decodeAaveVotingMachineLog', () => {
  it('decodes VoteEmitted', () => {
    const fixture = loadFixture('vote-emitted');
    expect(decodeAaveVotingMachineLog(makeLog(fixture), 'aave_voting_machine')).toEqual({
      type: 'VoteEmitted',
      payload: {
        proposalId: '201',
        voter: '0x1111111111111111111111111111111111111111',
        support: true,
        votingPower: '1234567890123456789',
      },
    });
  });

  it('decodes ProposalVoteStarted', () => {
    const fixture = loadFixture('proposal-vote-started');
    expect(decodeAaveVotingMachineLog(makeLog(fixture), 'aave_voting_machine')).toEqual({
      type: 'ProposalVoteStarted',
      payload: {
        proposalId: '202',
        l1BlockHash: '0x3434343434343434343434343434343434343434343434343434343434343434',
        startTime: '1717171717',
        endTime: '1717258117',
      },
    });
  });

  it('decodes ProposalResultsSent', () => {
    const fixture = loadFixture('proposal-results-sent');
    expect(decodeAaveVotingMachineLog(makeLog(fixture), 'aave_voting_machine')).toEqual({
      type: 'ProposalResultsSent',
      payload: {
        proposalId: '203',
        forVotes: '888888888888888888',
        againstVotes: '111111111111111111',
      },
    });
  });

  it('decodes ProposalVoteConfigurationBridged', () => {
    const fixture = loadFixture('proposal-vote-configuration-bridged');
    expect(decodeAaveVotingMachineLog(makeLog(fixture), 'aave_voting_machine')).toEqual({
      type: 'ProposalVoteConfigurationBridged',
      payload: {
        proposalId: '204',
        blockHash: '0x5656565656565656565656565656565656565656565656565656565656565656',
        votingDuration: 86400,
        voteCreated: true,
      },
    });
  });

  it('throws parse_failed on malformed data', () => {
    const fixture = loadFixture('proposal-results-sent');
    expect(() =>
      decodeAaveVotingMachineLog(
        makeLog({ topics: fixture.topics, data: '0x1234' }),
        'aave_voting_machine',
      ),
    ).toThrow(DecodeError);
    try {
      decodeAaveVotingMachineLog(
        makeLog({ topics: fixture.topics, data: '0x1234' }),
        'aave_voting_machine',
      );
    } catch (err) {
      expect((err as DecodeError).reason).toBe('parse_failed');
    }
  });

  it('throws unknown_topic on foreign topic', () => {
    const encoded = AAVE_VOTING_MACHINE_INTERFACE.encodeEventLog(
      AAVE_VOTING_MACHINE_INTERFACE.getEvent('ProposalResultsSent')!,
      [999n, 1n, 2n],
    );
    vi.spyOn(AAVE_VOTING_MACHINE_INTERFACE, 'parseLog').mockReturnValueOnce({
      name: 'Transfer',
      fragment: { topicHash: '0x' + 'ff'.repeat(32) },
    } as never);

    expect(() =>
      decodeAaveVotingMachineLog(
        makeLog({ topics: encoded.topics as string[], data: encoded.data }),
        'aave_voting_machine',
      ),
    ).toThrow(DecodeError);
  });

  it('throws unknown_topic when parseLog returns null', () => {
    vi.spyOn(AAVE_VOTING_MACHINE_INTERFACE, 'parseLog').mockReturnValueOnce(null);

    expect(() =>
      decodeAaveVotingMachineLog(
        makeLog(loadFixture('proposal-results-sent')),
        'aave_voting_machine',
      ),
    ).toThrow(DecodeError);
  });
});
