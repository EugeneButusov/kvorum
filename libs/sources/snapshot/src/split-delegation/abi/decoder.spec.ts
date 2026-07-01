import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeSplitDelegationLog } from './decoder';
import { SPLIT_DELEGATION_INTERFACE } from './events';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const DELEGATE_B32 = `0x${'00'.repeat(12)}${'22'.repeat(20)}`;
const CONTEXT = 'lido-snapshot.eth';

function baseLog(topics: string[], data: string): LogEvent {
  return {
    sourceType: 'snapshot_split_delegation',
    chainId: '0x1',
    blockNumber: 1n,
    blockHash: `0x${'bb'.repeat(32)}`,
    txHash: `0x${'cc'.repeat(32)}`,
    txIndex: 0,
    logIndex: 0,
    address: `0x${'de'.repeat(20)}`,
    topics,
    data,
  };
}

function encode(eventName: string, values: unknown[]): LogEvent {
  const fragment = SPLIT_DELEGATION_INTERFACE.getEvent(eventName)!;
  const { data, topics } = SPLIT_DELEGATION_INTERFACE.encodeEventLog(fragment, values);
  return baseLog(topics, data);
}

describe('decodeSplitDelegationLog', () => {
  it('decodes DelegationUpdated with delegate entries, ratios, and expiration', () => {
    const log = encode('DelegationUpdated', [
      ACCOUNT,
      CONTEXT,
      [],
      [{ delegate: DELEGATE_B32, ratio: 3n }],
      1893456000n,
    ]);
    const decoded = decodeSplitDelegationLog(log);
    expect(decoded.type).toBe('DelegationUpdated');
    if (decoded.type !== 'DelegationUpdated') throw new Error('unreachable');
    expect(decoded.payload.account).toBe(ACCOUNT);
    expect(decoded.payload.context).toBe(CONTEXT);
    expect(decoded.payload.delegation).toEqual([{ delegate: DELEGATE_B32, ratio: '3' }]);
    expect(decoded.payload.expirationTimestamp).toBe('1893456000');
  });

  it('decodes DelegationCleared', () => {
    const log = encode('DelegationCleared', [
      ACCOUNT,
      CONTEXT,
      [{ delegate: DELEGATE_B32, ratio: 1n }],
    ]);
    const decoded = decodeSplitDelegationLog(log);
    expect(decoded.type).toBe('DelegationCleared');
    if (decoded.type !== 'DelegationCleared') throw new Error('unreachable');
    expect(decoded.payload.context).toBe(CONTEXT);
  });

  it('decodes ExpirationUpdated', () => {
    const log = encode('ExpirationUpdated', [
      ACCOUNT,
      CONTEXT,
      [{ delegate: DELEGATE_B32, ratio: 1n }],
      0n,
    ]);
    const decoded = decodeSplitDelegationLog(log);
    expect(decoded.type).toBe('ExpirationUpdated');
  });

  it('decodes OptOutStatusSet', () => {
    const log = encode('OptOutStatusSet', [`0x${'22'.repeat(20)}`, CONTEXT, true]);
    const decoded = decodeSplitDelegationLog(log);
    expect(decoded.type).toBe('OptOutStatusSet');
    if (decoded.type !== 'OptOutStatusSet') throw new Error('unreachable');
    expect(decoded.payload.optout).toBe(true);
  });

  it('throws DecodeError on an unparseable log', () => {
    expect(() => decodeSplitDelegationLog(baseLog(['0xdead'], '0x'))).toThrow(DecodeError);
  });
});
