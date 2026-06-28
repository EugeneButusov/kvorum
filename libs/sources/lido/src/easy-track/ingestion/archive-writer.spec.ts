import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import { LidoEasyTrackArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer.types';
import type { EasyTrackEvent } from '../domain/types';
import type { EasyTrackEventRepository } from '../persistence/event-repository';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000003',
  sourceType: 'easy_track',
  chainId: '0x1',
  sourceLabel: 'easy_track',
};

const DECODED: EasyTrackEvent = {
  type: 'MotionCreated',
  payload: {
    motionId: '42',
    creator: '0x1111111111111111111111111111111111111111',
    evmScriptFactory: '0x2222222222222222222222222222222222222222',
    evmScriptCallData: '0xabcd',
    evmScript: '0x00000001',
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'easy_track',
  chainId: '0x1',
  blockNumber: 18000000n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  txIndex: 0,
  logIndex: 3,
  address: '0xf0211b7660680b49de1a7e9f25c65660f0a13fea',
  topics: [],
  data: '0x',
};

function makeEventRepo(): EasyTrackEventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as EasyTrackEventRepository;
}

function makeArchiveEventRepo(): ArchiveEventRepository {
  return {
    find: vi.fn(),
    insert: vi.fn().mockResolvedValue({ id: 'uuid-1' }),
  } as unknown as ArchiveEventRepository;
}

function makeDlqRepo(): DlqRepository {
  return {
    insert: vi.fn(),
  } as unknown as DlqRepository;
}

describe('LidoEasyTrackArchiveWriter', () => {
  it('constructs with the archive_event_stage DLQ stage', () => {
    const writer = new LidoEasyTrackArchiveWriter({
      eventRepo: makeEventRepo(),
      archiveEventRepo: makeArchiveEventRepo(),
      dlqRepo: makeDlqRepo(),
      logger: silentLogger,
    });
    expect(writer).toBeInstanceOf(LidoEasyTrackArchiveWriter);
  });

  it('insertEvent maps the decoded event into the source repository row', async () => {
    const eventRepo = makeEventRepo();
    const writer = new LidoEasyTrackArchiveWriter({
      eventRepo,
      archiveEventRepo: makeArchiveEventRepo(),
      dlqRepo: makeDlqRepo(),
      logger: silentLogger,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    await writer.writeCore(CTX, DECODED, LOG_REF);

    expect(eventRepo.insert).toHaveBeenCalledWith({
      daoSourceId: CTX.daoSourceId,
      chainId: CTX.chainId,
      blockNumber: LOG_REF.blockNumber.toString(),
      blockHash: LOG_REF.blockHash,
      txHash: LOG_REF.txHash,
      logIndex: LOG_REF.logIndex,
      eventType: DECODED.type,
      payload: JSON.stringify(DECODED.payload),
    });
  });
});
