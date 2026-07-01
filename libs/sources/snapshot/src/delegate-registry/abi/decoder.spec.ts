import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeDelegateRegistryLog } from './decoder';
import { DELEGATE_REGISTRY_INTERFACE } from './events';
import { encodeSpaceId } from '../../delegation/address';

const DELEGATOR = `0x${'11'.repeat(20)}`;
const DELEGATE = `0x${'22'.repeat(20)}`;
const SPACE_ID = encodeSpaceId('lido-snapshot.eth');

function makeLog(eventName: 'SetDelegate' | 'ClearDelegate', id = SPACE_ID): LogEvent {
  const fragment = DELEGATE_REGISTRY_INTERFACE.getEvent(eventName)!;
  const { data, topics } = DELEGATE_REGISTRY_INTERFACE.encodeEventLog(fragment, [
    DELEGATOR,
    id,
    DELEGATE,
  ]);
  return {
    sourceType: 'snapshot_delegate_registry',
    chainId: '0x1',
    blockNumber: 1n,
    blockHash: `0x${'bb'.repeat(32)}`,
    txHash: `0x${'cc'.repeat(32)}`,
    txIndex: 0,
    logIndex: 0,
    address: `0x${'46'.repeat(20)}`,
    topics,
    data,
  };
}

describe('decodeDelegateRegistryLog', () => {
  it('decodes SetDelegate with lowercased addresses and the raw bytes32 id', () => {
    const decoded = decodeDelegateRegistryLog(makeLog('SetDelegate'));
    expect(decoded.type).toBe('SetDelegate');
    expect(decoded.payload.delegator).toBe(DELEGATOR);
    expect(decoded.payload.delegate).toBe(DELEGATE);
    expect(decoded.payload.id).toBe(SPACE_ID);
  });

  it('decodes ClearDelegate', () => {
    const decoded = decodeDelegateRegistryLog(makeLog('ClearDelegate'));
    expect(decoded.type).toBe('ClearDelegate');
  });

  it('throws DecodeError on an unparseable log', () => {
    const bad = { ...makeLog('SetDelegate'), topics: ['0xdead'], data: '0x' };
    expect(() => decodeDelegateRegistryLog(bad)).toThrow(DecodeError);
  });
});
