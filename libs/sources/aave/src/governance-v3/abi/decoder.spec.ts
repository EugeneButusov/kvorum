import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeAaveGovernanceV3Log } from './decoder';
import { AAVE_GOVERNANCE_V3_INTERFACE } from './events';

function loadFixture(name: string): { topics: string[]; data: string } {
  const path = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'logs', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as { topics: string[]; data: string };
}

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'aave_governance_v3',
    chainId: '0x1',
    blockNumber: 20000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    txIndex: 0,
    logIndex: 0,
    address: '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

describe('decodeAaveGovernanceV3Log', () => {
  it('decodes ProposalCreated', () => {
    const fixture = loadFixture('proposal-created');
    expect(decodeAaveGovernanceV3Log(makeLog(fixture), 'aave_governance_v3')).toEqual({
      type: 'ProposalCreated',
      payload: {
        proposalId: '101',
        creator: '0x1111111111111111111111111111111111111111',
        accessLevel: 2,
        ipfsHash: '0x1212121212121212121212121212121212121212121212121212121212121212',
      },
    });
  });

  it('decodes VotingActivated', () => {
    const fixture = loadFixture('voting-activated');
    expect(decodeAaveGovernanceV3Log(makeLog(fixture), 'aave_governance_v3')).toEqual({
      type: 'VotingActivated',
      payload: {
        proposalId: '102',
        votingDuration: 86400,
      },
    });
  });

  it('decodes ProposalQueued', () => {
    const fixture = loadFixture('proposal-queued');
    expect(decodeAaveGovernanceV3Log(makeLog(fixture), 'aave_governance_v3')).toEqual({
      type: 'ProposalQueued',
      payload: {
        proposalId: '103',
        votesFor: '1234567890123456789',
        votesAgainst: '987654321',
      },
    });
  });

  it('decodes ProposalExecuted', () => {
    const fixture = loadFixture('proposal-executed');
    expect(decodeAaveGovernanceV3Log(makeLog(fixture), 'aave_governance_v3')).toEqual({
      type: 'ProposalExecuted',
      payload: { proposalId: '104' },
    });
  });

  it('decodes ProposalCanceled', () => {
    const fixture = loadFixture('proposal-canceled');
    expect(decodeAaveGovernanceV3Log(makeLog(fixture), 'aave_governance_v3')).toEqual({
      type: 'ProposalCanceled',
      payload: { proposalId: '105' },
    });
  });

  it('decodes ProposalFailed', () => {
    const fixture = loadFixture('proposal-failed');
    expect(decodeAaveGovernanceV3Log(makeLog(fixture), 'aave_governance_v3')).toEqual({
      type: 'ProposalFailed',
      payload: {
        proposalId: '106',
        votesFor: '111111111111111111',
        votesAgainst: '222222222222222222',
      },
    });
  });

  it('decodes PayloadSent', () => {
    const fixture = loadFixture('payload-sent');
    expect(decodeAaveGovernanceV3Log(makeLog(fixture), 'aave_governance_v3')).toEqual({
      type: 'PayloadSent',
      payload: {
        proposalId: '107',
        payloadId: '55',
        payloadsController: '0x2222222222222222222222222222222222222222',
        chainId: '137',
        payloadNumberOnProposal: '1',
        numberOfPayloadsOnProposal: '3',
      },
    });
  });

  it('throws parse_failed on malformed data', () => {
    const fixture = loadFixture('proposal-queued');
    expect(() =>
      decodeAaveGovernanceV3Log(
        makeLog({ topics: fixture.topics, data: '0x1234' }),
        'aave_governance_v3',
      ),
    ).toThrow(DecodeError);
    try {
      decodeAaveGovernanceV3Log(
        makeLog({ topics: fixture.topics, data: '0x1234' }),
        'aave_governance_v3',
      );
    } catch (err) {
      expect((err as DecodeError).reason).toBe('parse_failed');
    }
  });

  it('throws unknown_topic on foreign topic', () => {
    const encoded = AAVE_GOVERNANCE_V3_INTERFACE.encodeEventLog(
      AAVE_GOVERNANCE_V3_INTERFACE.getEvent('ProposalExecuted')!,
      [999n],
    );
    vi.spyOn(AAVE_GOVERNANCE_V3_INTERFACE, 'parseLog').mockReturnValueOnce({
      name: 'Transfer',
      fragment: { topicHash: '0x' + 'ff'.repeat(32) },
    } as never);

    expect(() =>
      decodeAaveGovernanceV3Log(
        makeLog({ topics: encoded.topics as string[], data: encoded.data }),
        'aave_governance_v3',
      ),
    ).toThrow(DecodeError);
  });

  it('throws unknown_topic when parseLog returns null', () => {
    vi.spyOn(AAVE_GOVERNANCE_V3_INTERFACE, 'parseLog').mockReturnValueOnce(null);

    expect(() =>
      decodeAaveGovernanceV3Log(makeLog(loadFixture('proposal-executed')), 'aave_governance_v3'),
    ).toThrow(DecodeError);
  });
});
