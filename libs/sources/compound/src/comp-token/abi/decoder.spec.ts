import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { decodeCompTokenLog } from './decoder';
import { COMPOUND_COMP_TOKEN_INTERFACE } from './events';
import { DecodeError } from '../../shared';

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'compound_comp_token',
    chainId: 1,
    blockNumber: 20000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    txIndex: 0,
    logIndex: 0,
    address: '0xc00e94cb662c3520282e6f5717214004a7f26888',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

describe('decodeCompTokenLog', () => {
  it('decodes DelegateChanged', () => {
    const encoded = COMPOUND_COMP_TOKEN_INTERFACE.encodeEventLog(
      COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateChanged')!,
      [
        '0x1111111111111111111111111111111111111111',
        '0x0000000000000000000000000000000000000000',
        '0x2222222222222222222222222222222222222222',
      ],
    );

    const decoded = decodeCompTokenLog(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
    );
    expect(decoded).toEqual({
      type: 'DelegateChanged',
      payload: {
        delegator: '0x1111111111111111111111111111111111111111',
        fromDelegate: '0x0000000000000000000000000000000000000000',
        toDelegate: '0x2222222222222222222222222222222222222222',
      },
    });
  });

  it('decodes DelegateVotesChanged', () => {
    const encoded = COMPOUND_COMP_TOKEN_INTERFACE.encodeEventLog(
      COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateVotesChanged')!,
      ['0x1111111111111111111111111111111111111111', 5n, 9n],
    );
    const decoded = decodeCompTokenLog(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
    );

    expect(decoded).toEqual({
      type: 'DelegateVotesChanged',
      payload: {
        delegate: '0x1111111111111111111111111111111111111111',
        previousVotes: '5',
        newVotes: '9',
      },
    });
  });

  it('throws unknown_topic for unmatched topic0', () => {
    expect(() => decodeCompTokenLog(makeLog({ topics: ['0x' + '00'.repeat(32)] }))).toThrow(
      DecodeError,
    );
  });

  it('throws parse_failed for wrong topic count', () => {
    const encoded = COMPOUND_COMP_TOKEN_INTERFACE.encodeEventLog(
      COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateChanged')!,
      [
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
        '0x3333333333333333333333333333333333333333',
      ],
    );
    const badTopics = (encoded.topics as string[]).slice(0, 3);

    expect(() => decodeCompTokenLog(makeLog({ topics: badTopics, data: encoded.data }))).toThrow(
      DecodeError,
    );
  });
});
