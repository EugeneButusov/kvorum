import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { ArchiveWriteContext } from '@sources/core';
import { CompTokenArchiveWriter } from './archive-writer';
import type { CompTokenEvent } from '../domain/types';
import type { CompTokenEventRepository } from '../persistence/event-repository';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_comp_token',
  chainId: '1',
  sourceLabel: 'compound_comp_token',
};

const DECODED: CompTokenEvent = {
  type: 'DelegateChanged',
  payload: {
    delegator: '0x1111111111111111111111111111111111111111',
    fromDelegate: '0x0000000000000000000000000000000000000000',
    toDelegate: '0x2222222222222222222222222222222222222222',
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'compound_comp_token',
  chainId: 1,
  blockNumber: 20000000n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
  txIndex: 0,
  logIndex: 0,
  address: '0xc00e94cb662c3520282e6f5717214004a7f26888',
  topics: ['0x9c8d2f3b5f31'],
  data: '0x',
};

function makeEventRepo(): CompTokenEventRepository {
  return { insert: vi.fn().mockResolvedValue(undefined) } as unknown as CompTokenEventRepository;
}

function makeArchiveEventRepo(): ArchiveEventRepository {
  return {
    find: vi.fn(),
    insert: vi.fn().mockResolvedValue({ id: 'uuid-1' }),
  } as unknown as ArchiveEventRepository;
}

function makeDlqRepo(): DlqRepository {
  return { insert: vi.fn() } as unknown as DlqRepository;
}

describe('CompTokenArchiveWriter.insertEvent', () => {
  it('maps the decoded event into the source repository row', async () => {
    const eventRepo = makeEventRepo();
    const writer = new CompTokenArchiveWriter({
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
