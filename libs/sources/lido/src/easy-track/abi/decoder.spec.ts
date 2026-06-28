import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeEasyTrackLog } from './decoder';
import { EASY_TRACK_INTERFACE } from './events';

function makeLog(encoded: { topics: ReadonlyArray<string>; data: string }): LogEvent {
  return {
    sourceType: 'easy_track',
    chainId: '0x1',
    blockNumber: 13676729n,
    blockHash: '0x' + 'ab'.repeat(32),
    txHash: '0x' + 'cd'.repeat(32),
    txIndex: 0,
    logIndex: 4,
    address: '0xF0211b7660680B49De1A7E9f25C65660F0a13Fea'.toLowerCase(),
    topics: encoded.topics as string[],
    data: encoded.data,
  };
}

function etLog(name: string, values: unknown[]): LogEvent {
  const fragment = EASY_TRACK_INTERFACE.getEvent(name)!;
  return makeLog(EASY_TRACK_INTERFACE.encodeEventLog(fragment, values));
}

const CREATOR = '0x1111111111111111111111111111111111111111';
const FACTORY = '0x2222222222222222222222222222222222222222';
const OBJECTOR = '0x3333333333333333333333333333333333333333';
const EXECUTOR = '0x4444444444444444444444444444444444444444';

describe('decodeEasyTrackLog', () => {
  it('decodes MotionCreated with the factory + raw EVMScript carried through', () => {
    const decoded = decodeEasyTrackLog(
      etLog('MotionCreated', [42n, CREATOR, FACTORY, '0xc0ffee', '0xdeadbeef']),
      'easy_track',
    );
    expect(decoded).toEqual({
      type: 'MotionCreated',
      payload: {
        motionId: '42',
        creator: CREATOR,
        evmScriptFactory: FACTORY,
        evmScriptCallData: '0xc0ffee',
        evmScript: '0xdeadbeef',
      },
    });
  });

  it('decodes MotionObjected with the running objection tally', () => {
    const decoded = decodeEasyTrackLog(
      etLog('MotionObjected', [42n, OBJECTOR, 1000n, 2500n, 50n]),
      'easy_track',
    );
    expect(decoded).toEqual({
      type: 'MotionObjected',
      payload: {
        motionId: '42',
        objector: OBJECTOR,
        weight: '1000',
        newObjectionsAmount: '2500',
        newObjectionsAmountPct: '50',
      },
    });
  });

  it('decodes the motion-id-only terminal events', () => {
    for (const event of ['MotionRejected', 'MotionCanceled', 'MotionEnacted'] as const) {
      const decoded = decodeEasyTrackLog(etLog(event, [7n]), 'easy_track');
      expect(decoded).toEqual({ type: event, payload: { motionId: '7' } });
    }
  });

  it('decodes the settings events', () => {
    expect(decodeEasyTrackLog(etLog('MotionDurationChanged', [259200n]), 'easy_track')).toEqual({
      type: 'MotionDurationChanged',
      payload: { motionDuration: '259200' },
    });
    expect(decodeEasyTrackLog(etLog('ObjectionsThresholdChanged', [50n]), 'easy_track')).toEqual({
      type: 'ObjectionsThresholdChanged',
      payload: { newThreshold: '50' },
    });
    expect(decodeEasyTrackLog(etLog('MotionsCountLimitChanged', [12n]), 'easy_track')).toEqual({
      type: 'MotionsCountLimitChanged',
      payload: { newMotionsCountLimit: '12' },
    });
  });

  it('decodes EVMScriptExecutorChanged with a lowercased address', () => {
    const decoded = decodeEasyTrackLog(etLog('EVMScriptExecutorChanged', [EXECUTOR]), 'easy_track');
    expect(decoded).toEqual({
      type: 'EVMScriptExecutorChanged',
      payload: { evmScriptExecutor: EXECUTOR },
    });
  });

  it('throws DecodeError on an unknown topic', () => {
    const log = makeLog({ topics: ['0x' + 'ff'.repeat(32)], data: '0x' });
    expect(() => decodeEasyTrackLog(log, 'easy_track')).toThrow(DecodeError);
  });
});
