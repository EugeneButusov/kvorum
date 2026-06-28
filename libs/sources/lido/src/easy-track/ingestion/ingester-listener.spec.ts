import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveWriteContext } from '@sources/core';
import type { LidoEasyTrackArchiveWriter } from './archive-writer';
import { makeEasyTrackIngesterListener } from './ingester-listener';
import { EASY_TRACK_INTERFACE } from '../abi/events';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000003',
  sourceType: 'easy_track',
  chainId: '0x1',
  sourceLabel: 'easy_track',
};

const EASY_TRACK_ADDRESS = '0xf0211b7660680b49de1a7e9f25c65660f0a13fea';

function makeLog(eventName: string, args: unknown[]): LogEvent {
  const fragment = EASY_TRACK_INTERFACE.getEvent(eventName)!;
  const encoded = EASY_TRACK_INTERFACE.encodeEventLog(fragment, args);
  return {
    sourceType: 'easy_track',
    chainId: '0x1',
    blockNumber: 13680000n,
    blockHash: '0x' + 'ab'.repeat(32),
    txHash: '0x' + 'cd'.repeat(32),
    txIndex: 0,
    logIndex: 1,
    address: EASY_TRACK_ADDRESS,
    topics: encoded.topics as string[],
    data: encoded.data,
  };
}

describe('makeEasyTrackIngesterListener', () => {
  it('decodes each log and writes the decoded event through the archive writer', async () => {
    const write = vi.fn().mockResolvedValue({ result: 'inserted' });
    const archiveWriter = { write } as unknown as LidoEasyTrackArchiveWriter;
    const listener = makeEasyTrackIngesterListener({
      archiveWriter,
      context: CTX,
      logger: silentLogger,
      dlqRepo: { insert: vi.fn() } as unknown as DlqRepository,
    });

    const log = makeLog('MotionEnacted', [7n]);
    await listener([log]);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      CTX,
      { type: 'MotionEnacted', payload: { motionId: '7' } },
      log,
    );
  });

  it('routes an undecodable log to the DLQ without throwing (decode callback rejects unknown topics)', async () => {
    const write = vi.fn();
    const dlqInsert = vi.fn().mockResolvedValue(undefined);
    const listener = makeEasyTrackIngesterListener({
      archiveWriter: { write } as unknown as LidoEasyTrackArchiveWriter,
      context: CTX,
      logger: silentLogger,
      dlqRepo: { insert: dlqInsert } as unknown as DlqRepository,
    });

    const unknownTopicLog: LogEvent = {
      sourceType: 'easy_track',
      chainId: '0x1',
      blockNumber: 13680000n,
      blockHash: '0x' + 'ab'.repeat(32),
      txHash: '0x' + 'ef'.repeat(32),
      txIndex: 0,
      logIndex: 2,
      address: EASY_TRACK_ADDRESS,
      topics: ['0x' + '00'.repeat(32)],
      data: '0x',
    };

    await expect(listener([unknownTopicLog])).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    expect(dlqInsert).toHaveBeenCalledTimes(1);
  });
});
