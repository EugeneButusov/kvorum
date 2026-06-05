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
    chainId: '0xa86a',
    blockNumber: 86324033n,
    blockHash: '0x813a915c19b7bf1559e98d257ea357ee2490b9442c54c449c24b134fa5182281',
    txHash: '0x89fb60c202d3a34d0bdd20ba4bd7404711ad9cd1e8a1f71059c31686fa290b92',
    txIndex: 0,
    logIndex: 0,
    address: '0x4d1863d22d0ed8579f8999388bcc833cb057c2d6',
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
        proposalId: '489',
        voter: '0x4d4ac65513fee380c596ac9edfac588782831bdf',
        support: true,
        votingPower: '10515607793132578',
      },
    });
  });

  it('decodes ProposalVoteStarted', () => {
    const fixture = loadFixture('proposal-vote-started');
    expect(decodeAaveVotingMachineLog(makeLog(fixture), 'aave_voting_machine')).toEqual({
      type: 'ProposalVoteStarted',
      payload: {
        proposalId: '489',
        l1BlockHash: '0xc56bf32463a809c7e66826526b8e43f2ef3c1efb20675e1d01abb5873deef91e',
        startTime: '1779698667',
        endTime: '1779957867',
      },
    });
  });

  it('decodes ProposalResultsSent', () => {
    const fixture = loadFixture('proposal-results-sent');
    expect(decodeAaveVotingMachineLog(makeLog(fixture), 'aave_voting_machine')).toEqual({
      type: 'ProposalResultsSent',
      payload: {
        proposalId: '489',
        forVotes: '468390242303422047538850',
        againstVotes: '6036125569661314401',
      },
    });
  });

  it('decodes ProposalVoteConfigurationBridged', () => {
    const fixture = loadFixture('proposal-vote-configuration-bridged');
    expect(decodeAaveVotingMachineLog(makeLog(fixture), 'aave_voting_machine')).toEqual({
      type: 'ProposalVoteConfigurationBridged',
      payload: {
        proposalId: '489',
        blockHash: '0xc56bf32463a809c7e66826526b8e43f2ef3c1efb20675e1d01abb5873deef91e',
        votingDuration: 259200,
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
