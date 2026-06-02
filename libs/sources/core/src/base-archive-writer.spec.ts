import { describe, it, expect, vi } from 'vitest';
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
) {
  const w = new TestWriter(archiveRepo, dlqRepo, silentLogger, stage, () => new Date('2026-01-01'));
  w.insertSpy.mockResolvedValue(undefined);
  return { w, archiveRepo, dlqRepo };
}

describe('BaseArchiveWriter.write', () => {
  it('#1 — existing row found → returns skipped_existing, no inserts', async () => {
    const archiveRepo = makeArchiveRepo({ find: vi.fn().mockResolvedValue({ id: 'existing' }) });
    const { w } = makeWriter(archiveRepo);

    const out = await w.write(CTX, DECODED, LOG);
    expect(out.result).toBe('skipped_existing');
    expect(archiveRepo.insert).not.toHaveBeenCalled();
    expect(w.insertSpy).not.toHaveBeenCalled();
  });

  it('#2 — happy path → insertEvent + archiveEventRepo.insert called, returns inserted', async () => {
    const { w, archiveRepo } = makeWriter();

    const out = await w.write(CTX, DECODED, LOG);
    expect(out.result).toBe('inserted');
    expect(w.insertSpy).toHaveBeenCalledOnce();
    expect(archiveRepo.insert).toHaveBeenCalledOnce();
  });

  it('#3 — insertEvent throws → archiveEventRepo.insert NOT called, DLQ routed', async () => {
    const { w, archiveRepo, dlqRepo } = makeWriter();
    w.insertSpy.mockRejectedValue(new Error('CH down'));

    const out = await w.write(CTX, DECODED, LOG);
    expect(out.result).toBe('dlq_routed');
    expect(archiveRepo.insert).not.toHaveBeenCalled();
    expect(dlqRepo.insert).toHaveBeenCalledOnce();
  });

  it('#4 — archiveEventRepo.insert throws → DLQ routed', async () => {
    const archiveRepo = makeArchiveRepo({
      insert: vi.fn().mockRejectedValue(new Error('PG down')),
    });
    const { w, dlqRepo } = makeWriter(archiveRepo);

    const out = await w.write(CTX, DECODED, LOG);
    expect(out.result).toBe('dlq_routed');
    expect(dlqRepo.insert).toHaveBeenCalledOnce();
  });

  it('#5 — DLQ insert also fails → returns unreachable', async () => {
    const archiveRepo = makeArchiveRepo({
      insert: vi.fn().mockRejectedValue(new Error('PG down')),
    });
    const dlqRepo = makeDlqRepo({ insert: vi.fn().mockRejectedValue(new Error('DLQ down')) });
    const { w } = makeWriter(archiveRepo, dlqRepo);

    const out = await w.write(CTX, DECODED, LOG);
    expect(out.result).toBe('unreachable');
  });

  it('#6 — DLQ row contains correct stage, source, txHash, logIndex, blockHash', async () => {
    const archiveRepo = makeArchiveRepo({
      insert: vi.fn().mockRejectedValue(new Error('PG fail')),
    });
    const dlqRepo = makeDlqRepo();
    const { w } = makeWriter(archiveRepo, dlqRepo, 'my_stage');

    await w.write(CTX, DECODED, LOG);

    const row = (dlqRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(row.stage).toBe('my_stage');
    expect(row.source).toBe(CTX.sourceLabel);
    expect(row.archive_tx_hash).toBe(LOG.txHash);
    expect(row.archive_log_index).toBe(LOG.logIndex);
    expect(row.archive_block_hash).toBe(LOG.blockHash);
  });
});

describe('BaseArchiveWriter.writeCore', () => {
  it('#7 — calls insertEvent then archiveEventRepo.insert with block fields', async () => {
    const { w, archiveRepo } = makeWriter();
    const receivedAt = new Date('2026-06-01T00:00:00Z');

    await w.writeCore(CTX, DECODED, LOG, receivedAt);

    expect(w.insertSpy).toHaveBeenCalledWith(CTX, DECODED, LOG);
    const row = (archiveRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(row.tx_hash).toBe(LOG.txHash);
    expect(row.log_index).toBe(LOG.logIndex);
    expect(row.event_type).toBe(DECODED.type);
    expect(row.received_at).toBe(receivedAt);
  });
});
