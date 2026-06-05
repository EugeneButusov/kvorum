import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { LogEvent } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { ArchiveWriteContext } from './archive-writer-types';
import { BaseArchiveWriter } from './base-archive-writer';

type TestEvent = { type: 'ProposalCreated'; payload: Record<string, string> };

class TestWriter extends BaseArchiveWriter<TestEvent> {
  readonly insertSpy = vi.fn<[ArchiveWriteContext, TestEvent, LogEvent], Promise<void>>();

  protected insertEvent(
    ctx: ArchiveWriteContext,
    decoded: TestEvent,
    logRef: LogEvent,
  ): Promise<void> {
    return this.insertSpy(ctx, decoded, logRef);
  }
}

const CTX: ArchiveWriteContext = {
  daoSourceId: 'dao-src-1',
  sourceType: 'compound_governor_bravo',
  chainId: '0x1',
  sourceLabel: 'compound_governor_bravo',
};

const DECODED: TestEvent = { type: 'ProposalCreated', payload: { id: '42' } };

const LOG: LogEvent = {
  sourceType: 'compound_governor_bravo',
  chainId: 1,
  blockNumber: 20_000_000n,
  blockHash: '0x' + 'ab'.repeat(32),
  txHash: '0x' + 'cd'.repeat(32),
  txIndex: 0,
  logIndex: 3,
  address: '0x' + 'ef'.repeat(20),
  topics: ['0x' + '00'.repeat(32)],
  data: '0x',
};

function makeArchiveRepo(overrides: Partial<ArchiveEventRepository> = {}): ArchiveEventRepository {
  return {
    find: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue({ id: 'ae-1' }),
    ...overrides,
  } as unknown as ArchiveEventRepository;
}

function makeDlqRepo(overrides: Partial<DlqRepository> = {}): DlqRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DlqRepository;
}

function makeWriter(
  archiveRepo = makeArchiveRepo(),
  dlqRepo = makeDlqRepo(),
  stage = 'test_stage',
  now = () => new Date('2026-01-01T00:00:00Z'),
) {
  const writer = new TestWriter(archiveRepo, dlqRepo, silentLogger, stage, now);
  writer.insertSpy.mockResolvedValue(undefined);
  return { writer, archiveRepo, dlqRepo };
}

describe('BaseArchiveWriter.writeCore', () => {
  it('calls insertEvent before archiveEventRepo.insert and writes the archive row', async () => {
    const archiveRepo = makeArchiveRepo();
    const { writer } = makeWriter(archiveRepo);
    const calls: string[] = [];
    const receivedAt = new Date('2026-06-01T00:00:00Z');

    writer.insertSpy.mockImplementation(async () => {
      calls.push('ch');
    });
    (archiveRepo.insert as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('pg');
      return { id: 'ae-1' };
    });

    await writer.writeCore(CTX, DECODED, LOG, receivedAt);

    expect(calls).toEqual(['ch', 'pg']);
    expect(writer.insertSpy).toHaveBeenCalledWith(CTX, DECODED, LOG);
    expect(archiveRepo.insert).toHaveBeenCalledWith({
      source_type: CTX.sourceType,
      dao_source_id: CTX.daoSourceId,
      chain_id: CTX.chainId,
      block_number: LOG.blockNumber.toString(),
      block_hash: LOG.blockHash,
      tx_hash: LOG.txHash,
      log_index: LOG.logIndex,
      event_type: DECODED.type,
      received_at: receivedAt,
      derived_at: null,
    });
  });

  it('uses the injected clock when receivedAt is omitted', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const { writer, archiveRepo } = makeWriter(
      makeArchiveRepo(),
      makeDlqRepo(),
      'test_stage',
      () => now,
    );

    await writer.writeCore(CTX, DECODED, LOG);

    expect(archiveRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        received_at: now,
      }),
    );
  });

  it('propagates insertEvent failures and does not write PG', async () => {
    const { writer, archiveRepo } = makeWriter();
    writer.insertSpy.mockRejectedValue(new Error('CH down'));

    await expect(writer.writeCore(CTX, DECODED, LOG)).rejects.toThrow('CH down');
    expect(archiveRepo.insert).not.toHaveBeenCalled();
  });
});

describe('BaseArchiveWriter.write', () => {
  it('returns skipped_existing when the archive row already exists', async () => {
    const archiveRepo = makeArchiveRepo({ find: vi.fn().mockResolvedValue({ id: 'existing' }) });
    const { writer } = makeWriter(archiveRepo);

    const out = await writer.write(CTX, DECODED, LOG);

    expect(out).toEqual({ result: 'skipped_existing' });
    expect(archiveRepo.insert).not.toHaveBeenCalled();
    expect(writer.insertSpy).not.toHaveBeenCalled();
  });

  it('returns inserted when both writes succeed', async () => {
    const { writer, archiveRepo } = makeWriter();

    const out = await writer.write(CTX, DECODED, LOG);

    expect(out).toEqual({ result: 'inserted' });
    expect(writer.insertSpy).toHaveBeenCalledOnce();
    expect(archiveRepo.insert).toHaveBeenCalledOnce();
  });

  it('still returns inserted when archiveEventRepo.insert resolves undefined', async () => {
    const archiveRepo = makeArchiveRepo({ insert: vi.fn().mockResolvedValue(undefined) });
    const { writer } = makeWriter(archiveRepo);

    const out = await writer.write(CTX, DECODED, LOG);

    expect(out).toEqual({ result: 'inserted' });
  });

  it('routes insertEvent failures to the DLQ', async () => {
    const { writer, archiveRepo, dlqRepo } = makeWriter();
    writer.insertSpy.mockRejectedValue(new Error('CH down'));

    const out = await writer.write(CTX, DECODED, LOG);

    expect(out).toEqual({ result: 'dlq_routed' });
    expect(archiveRepo.insert).not.toHaveBeenCalled();
    expect(dlqRepo.insert).toHaveBeenCalledOnce();
  });

  it('routes archiveEventRepo.insert failures to the DLQ', async () => {
    const archiveRepo = makeArchiveRepo({
      insert: vi.fn().mockRejectedValue(new Error('PG down')),
    });
    const { writer, dlqRepo } = makeWriter(archiveRepo);

    const out = await writer.write(CTX, DECODED, LOG);

    expect(out).toEqual({ result: 'dlq_routed' });
    expect(dlqRepo.insert).toHaveBeenCalledOnce();
  });

  it('returns unreachable when the DLQ insert also fails', async () => {
    const archiveRepo = makeArchiveRepo({
      insert: vi.fn().mockRejectedValue(new Error('PG down')),
    });
    const dlqRepo = makeDlqRepo({ insert: vi.fn().mockRejectedValue(new Error('DLQ down')) });
    const { writer } = makeWriter(archiveRepo, dlqRepo);

    const out = await writer.write(CTX, DECODED, LOG);

    expect(out).toEqual({ result: 'unreachable' });
  });

  it('writes the expected DLQ row shape', async () => {
    const cause = Object.assign(new Error('FK violation'), { code: '23503', stack: 'stack...' });
    const archiveRepo = makeArchiveRepo({
      insert: vi.fn().mockRejectedValue(cause),
    });
    const dlqRepo = makeDlqRepo();
    const { writer } = makeWriter(archiveRepo, dlqRepo, 'my_stage');

    await writer.write(CTX, DECODED, LOG);

    expect(dlqRepo.insert).toHaveBeenCalledWith({
      stage: 'my_stage',
      source: CTX.sourceLabel,
      payload: {
        raw: { topics: LOG.topics, data: LOG.data },
        block_number: LOG.blockNumber.toString(),
      },
      error: expect.objectContaining({
        name: 'Error',
        message: 'FK violation',
        code: '23503',
        stack: 'stack...',
      }),
      retries: 0,
      first_seen_at: new Date('2026-01-01T00:00:00Z'),
      last_attempt_at: new Date('2026-01-01T00:00:00Z'),
      archive_source_type: CTX.sourceType,
      archive_chain_id: CTX.chainId,
      archive_tx_hash: LOG.txHash,
      archive_log_index: LOG.logIndex,
      archive_block_hash: LOG.blockHash,
    });
  });
});
