import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeAaveTokenLog } from './decoder';
import { AAVE_TOKEN_INTERFACE } from './events';

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'aave_token',
    chainId: 1,
    blockNumber: 20000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    txIndex: 0,
    logIndex: 0,
    address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

function encodeDelegateChanged(delegator: string, delegatee: string, delegationType: number) {
  return AAVE_TOKEN_INTERFACE.encodeEventLog(AAVE_TOKEN_INTERFACE.getEvent('DelegateChanged')!, [
    delegator,
    delegatee,
    delegationType,
  ]);
}

describe('decodeAaveTokenLog', () => {
  it('decodes a VOTING DelegateChanged', () => {
    const encoded = encodeDelegateChanged(
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      0,
    );
    const decoded = decodeAaveTokenLog(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
    );
    expect(decoded).toEqual({
      type: 'DelegateChanged',
      payload: {
        delegator: '0x1111111111111111111111111111111111111111',
        delegatee: '0x2222222222222222222222222222222222222222',
        delegationType: 0,
      },
    });
  });

  it('decodes a PROPOSITION DelegateChanged (delegationType=1)', () => {
    const encoded = encodeDelegateChanged(
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      1,
    );
    const decoded = decodeAaveTokenLog(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
    );
    expect(decoded.payload.delegationType).toBe(1);
  });

  it('decodes an undelegation (delegatee = address(0))', () => {
    const encoded = encodeDelegateChanged(
      '0x1111111111111111111111111111111111111111',
      '0x0000000000000000000000000000000000000000',
      0,
    );
    const decoded = decodeAaveTokenLog(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
    );
    expect(decoded.payload.delegatee).toBe('0x0000000000000000000000000000000000000000');
  });

  it('throws unknown_topic for an unmatched topic0', () => {
    expect(() => decodeAaveTokenLog(makeLog({ topics: ['0x' + '00'.repeat(32)] }))).toThrow(
      DecodeError,
    );
  });

  it('throws parse_failed for a malformed topic count', () => {
    const encoded = encodeDelegateChanged(
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      0,
    );
    const badTopics = (encoded.topics as string[]).slice(0, 2);
    expect(() => decodeAaveTokenLog(makeLog({ topics: badTopics, data: encoded.data }))).toThrow(
      DecodeError,
    );
  });
});
