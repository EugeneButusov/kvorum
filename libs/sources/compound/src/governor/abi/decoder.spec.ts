import { keccak256, toUtf8Bytes } from 'ethers';
import { describe, it, expect } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { decodeCompoundLog } from './decoder';
import {
  COMPOUND_ALPHA_TOPICS,
  COMPOUND_BRAVO_TOPICS,
  COMPOUND_OZ_TOPICS,
  COMPOUND_GOVERNOR_ALPHA_INTERFACE,
  COMPOUND_GOVERNOR_BRAVO_INTERFACE,
  COMPOUND_GOVERNOR_OZ_INTERFACE,
} from './events';
import { DecodeError } from '../domain/types';

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'compound_governor_bravo',
    chainId: 1,
    blockNumber: 20000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    txIndex: 0,
    logIndex: 0,
    address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

describe('decodeCompoundLog', () => {
  it('decodes ProposalExecuted for bravo', () => {
    const encoded = COMPOUND_GOVERNOR_BRAVO_INTERFACE.encodeEventLog(
      COMPOUND_GOVERNOR_BRAVO_INTERFACE.getEvent('ProposalExecuted')!,
      [42n],
    );
    const result = decodeCompoundLog(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'compound_governor_bravo',
    );
    expect(result).toEqual({ type: 'ProposalExecuted', payload: { proposalId: '42' } });
  });

  it('decodes alpha VoteCast bool support', () => {
    const encoded = COMPOUND_GOVERNOR_ALPHA_INTERFACE.encodeEventLog(
      COMPOUND_GOVERNOR_ALPHA_INTERFACE.getEvent('VoteCast')!,
      ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 7n, true, 999n],
    );

    const result = decodeCompoundLog(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'compound_governor_alpha',
    );

    expect(result).toEqual({
      type: 'VoteCast',
      payload: {
        voter: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        proposalId: '7',
        primaryChoice: 1,
        votingPowerReported: '999',
        compound: { supportRaw: true, reason: null },
      },
    });
  });

  it('decodes bravo VoteCast uint8 support + reason', () => {
    const encoded = COMPOUND_GOVERNOR_BRAVO_INTERFACE.encodeEventLog(
      COMPOUND_GOVERNOR_BRAVO_INTERFACE.getEvent('VoteCast')!,
      ['0x1111111111111111111111111111111111111111', 8n, 2n, 111n, 'because'],
    );

    const result = decodeCompoundLog(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'compound_governor_bravo',
    );

    expect(result).toEqual({
      type: 'VoteCast',
      payload: {
        voter: '0x1111111111111111111111111111111111111111',
        proposalId: '8',
        primaryChoice: 2,
        votingPowerReported: '111',
        compound: { supportRaw: 2, reason: 'because' },
      },
    });
  });

  it('decodes oz VoteCast weight field', () => {
    const encoded = COMPOUND_GOVERNOR_OZ_INTERFACE.encodeEventLog(
      COMPOUND_GOVERNOR_OZ_INTERFACE.getEvent('VoteCast')!,
      ['0x1111111111111111111111111111111111111111', 9n, 0n, 77n, ''],
    );

    const result = decodeCompoundLog(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'compound_governor_oz',
    );

    expect(result).toEqual({
      type: 'VoteCast',
      payload: {
        voter: '0x1111111111111111111111111111111111111111',
        proposalId: '9',
        primaryChoice: 0,
        votingPowerReported: '77',
        compound: { supportRaw: 0, reason: '' },
      },
    });
  });

  it('throws wrong_variant for unsupported source type', () => {
    const log = makeLog({ topics: [COMPOUND_BRAVO_TOPICS.ProposalExecuted] });
    expect(() => decodeCompoundLog(log, 'not_supported')).toThrow(DecodeError);
    try {
      decodeCompoundLog(log, 'not_supported');
    } catch (err) {
      expect((err as DecodeError).reason).toBe('wrong_variant');
    }
  });

  it('throws unknown_topic for variant-mismatched VoteCast topic', () => {
    const encoded = COMPOUND_GOVERNOR_BRAVO_INTERFACE.encodeEventLog(
      COMPOUND_GOVERNOR_BRAVO_INTERFACE.getEvent('VoteCast')!,
      ['0x1111111111111111111111111111111111111111', 9n, 0n, 77n, ''],
    );

    expect(() =>
      decodeCompoundLog(
        makeLog({ topics: encoded.topics as string[], data: encoded.data }),
        'compound_governor_alpha',
      ),
    ).toThrow(DecodeError);
  });

  it('proposal event topic0 values stay canonical across variants', () => {
    const knownCreated = keccak256(
      toUtf8Bytes(
        'ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)',
      ),
    ).toLowerCase();
    expect(COMPOUND_ALPHA_TOPICS.ProposalCreated).toBe(knownCreated);
    expect(COMPOUND_BRAVO_TOPICS.ProposalCreated).toBe(knownCreated);
    expect(COMPOUND_OZ_TOPICS.ProposalCreated).toBe(knownCreated);
  });
});
