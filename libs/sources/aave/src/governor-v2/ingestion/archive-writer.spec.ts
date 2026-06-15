import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import { AaveGovernorV2ArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer.types';
import type { AaveGovernorV2Event } from '../domain/types';
import type { AaveGovernorV2EventRepository } from '../persistence/event-repository';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_governor_v2',
  chainId: '0x1',
  sourceLabel: 'aave_governor_v2',
};

const DECODED: AaveGovernorV2Event = {
  type: 'ProposalCanceled',
  payload: { id: '7' },
};

const LOG_REF: LogEvent = {
  sourceType: 'aave_governor_v2',
  chainId: '0x1',
  blockNumber: 12_000_000n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  txIndex: 0,
  logIndex: 2,
  address: '0xec568fffba86c094cf06b22134b23074dfe2252c',
  topics: ['0x' + '00'.repeat(32)],
  data: '0x',
};

function makeEventRepo(): AaveGovernorV2EventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as AaveGovernorV2EventRepository;
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

describe('AaveGovernorV2ArchiveWriter', () => {
  it('forwards decoded event to the event repository with correct shape', async () => {
    const eventRepo = makeEventRepo();
    const writer = new AaveGovernorV2ArchiveWriter({
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
      eventType: 'ProposalCanceled',
      payload: JSON.stringify({ id: '7' }),
    });
  });

  it('routes to DLQ with aave_governor_v2_archive_write stage on write failure', async () => {
    const dlqRepo = makeDlqRepo();
    const failingArchiveRepo = {
      find: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockRejectedValue(new Error('pg failed')),
    } as unknown as ArchiveEventRepository;

    const writer = new AaveGovernorV2ArchiveWriter({
      eventRepo: {
        insert: vi.fn().mockResolvedValue(undefined),
      } as unknown as AaveGovernorV2EventRepository,
      archiveEventRepo: failingArchiveRepo,
      dlqRepo,
      logger: silentLogger,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const outcome = await writer.write(CTX, DECODED, LOG_REF);

    expect(outcome.result).toBe('dlq_routed');
    expect(dlqRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'aave_governor_v2_archive_write' }),
    );
  });
});
