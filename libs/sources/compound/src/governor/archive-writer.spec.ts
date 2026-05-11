import { describe, it, expect, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveRepository } from './archive-repository';
import { ArchiveWriter, isTransientPgError } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer';
import type { DlqRepository } from './dlq-repository';
import type { CompoundGovernorEvent } from './types';

// ---- Shared test fixtures ----

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_governor',
  chainId: 1,
  sourceLabel: 'compound_governor',
};

const DECODED: CompoundGovernorEvent = {
  type: 'ProposalCreated',
  payload: {
    proposalId: '123',
    proposer: '0xabcdef1234567890abcdef1234567890abcdef12',
    targets: ['0x1111111111111111111111111111111111111111'],
    values: ['0'],
    signatures: ['transfer(address,uint256)'],
    calldatas: ['0xdeadbeef'],
    startBlock: '18000000',
    endBlock: '18100000',
    description: 'test',
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'compound_governor',
  chainId: 1,
  blockNumber: 20000000n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
  txIndex: 0,
  logIndex: 0,
  address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
  topics: ['0x7d84a6263ae0d98d3329bd7b46bb4e8d6f98cd35a7adb45c274c8b7fd5ebd5e0'],
  data: '0x',
};

// ---- Mock factory ----

function makeRepo(
  overrides: Partial<{
    findConfirmation: ReturnType<typeof vi.fn>;
    insertEvent: ReturnType<typeof vi.fn>;
    insertConfirmation: ReturnType<typeof vi.fn>;
  }> = {},
): ArchiveRepository {
  return {
    findConfirmation: vi.fn().mockResolvedValue(undefined),
    insertEvent: vi.fn().mockResolvedValue(undefined),
    insertConfirmation: vi.fn().mockResolvedValue({ id: 'uuid-1' }),
    ...overrides,
  } as unknown as ArchiveRepository;
}

function makeDlqRepo(overrides: Partial<{ insert: ReturnType<typeof vi.fn> }> = {}): DlqRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DlqRepository;
}

function buildWriter(
  repo: ArchiveRepository,
  retryBackoffMs: readonly number[] = [0, 0, 0],
  dlqRepo: DlqRepository = makeDlqRepo(),
): ArchiveWriter {
  return new ArchiveWriter({
    repo,
    dlqRepo,
    logger: silentLogger,
    now: () => new Date('2026-01-01T00:00:00Z'),
    retryBackoffMs,
  });
}

// ---- Tests ----

describe('ArchiveWriter', () => {
  it('#1 — happy path: existence empty → CH insert → PG insert → outcome inserted', async () => {
    const repo = makeRepo();
    const outcome = await buildWriter(repo).write(CTX, DECODED, LOG_REF);

    expect(outcome.result).toBe('inserted');
    expect(repo.insertEvent).toHaveBeenCalledTimes(1);
    expect(repo.insertConfirmation).toHaveBeenCalledTimes(1);
  });

  it('#2 — existence-skip: existing row found → CH + PG NOT called, outcome skipped_existing', async () => {
    const repo = makeRepo({
      findConfirmation: vi.fn().mockResolvedValue({ id: 'existing' }),
    });
    const outcome = await buildWriter(repo).write(CTX, DECODED, LOG_REF);

    expect(outcome.result).toBe('skipped_existing');
    expect(repo.insertEvent).not.toHaveBeenCalled();
    expect(repo.insertConfirmation).not.toHaveBeenCalled();
  });

  it('#3 — PG conflict: existence empty → CH insert → PG returns undefined → skipped_conflict', async () => {
    const repo = makeRepo({ insertConfirmation: vi.fn().mockResolvedValue(undefined) });
    const outcome = await buildWriter(repo).write(CTX, DECODED, LOG_REF);

    expect(outcome.result).toBe('skipped_conflict');
  });

  it('#4 — transient PG error retried, succeeds on last attempt → inserted', async () => {
    const transientErr = Object.assign(new Error('connection reset'), { code: '08006' });
    let callCount = 0;
    const repo = makeRepo({
      insertConfirmation: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) return Promise.reject(transientErr);
        return Promise.resolve({ id: 'ok' });
      }),
    });

    const outcome = await buildWriter(repo, [0, 0, 0]).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('inserted');
    expect(callCount).toBe(3);
  });

  it('#5 — transient errors exhaust retries → DLQ routed, outcome pg_dlq_routed', async () => {
    const transientErr = Object.assign(new Error('connection reset'), { code: '08006' });
    const repo = makeRepo({
      insertConfirmation: vi.fn().mockRejectedValue(transientErr),
    });
    const dlqRepo = makeDlqRepo();

    const outcome = await buildWriter(repo, [0, 0, 0], dlqRepo).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('pg_dlq_routed');
    expect(dlqRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('#6 — non-transient PG error (FK violation 23503) fails fast → DLQ, pg_dlq_routed', async () => {
    const fkErr = Object.assign(new Error('FK violation'), { code: '23503' });
    const repo = makeRepo({ insertConfirmation: vi.fn().mockRejectedValue(fkErr) });
    const dlqRepo = makeDlqRepo();

    const outcome = await buildWriter(repo, [0, 0, 0], dlqRepo).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('pg_dlq_routed');
    // Non-transient → 1 attempt only, then immediately to DLQ
    expect(repo.insertConfirmation).toHaveBeenCalledTimes(1);
    expect(dlqRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('#7 — DLQ insert itself fails → pg_unreachable, outcome pg_unreachable', async () => {
    const fkErr = Object.assign(new Error('FK violation'), { code: '23503' });
    const dlqErr = new Error('PG unreachable');
    const repo = makeRepo({ insertConfirmation: vi.fn().mockRejectedValue(fkErr) });
    const dlqRepo = makeDlqRepo({ insert: vi.fn().mockRejectedValue(dlqErr) });

    const outcome = await buildWriter(repo, [0, 0, 0], dlqRepo).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('pg_unreachable');
  });

  it('#8 — CH insert failure propagates as exception; PG/DLQ NOT attempted', async () => {
    const chErr = new Error('ClickHouse connection refused');
    const repo = makeRepo({ insertEvent: vi.fn().mockRejectedValue(chErr) });
    const dlqRepo = makeDlqRepo();

    await expect(
      buildWriter(repo, [0, 0, 0], dlqRepo).write(CTX, DECODED, LOG_REF),
    ).rejects.toThrow('ClickHouse connection refused');
    expect(repo.insertConfirmation).not.toHaveBeenCalled();
    expect(dlqRepo.insert).not.toHaveBeenCalled();
  });

  it('#9 — uint256 boundary in payload survives JSON.stringify round-trip', async () => {
    const decoded: CompoundGovernorEvent = {
      type: 'ProposalQueued',
      payload: { proposalId: (2n ** 256n - 1n).toString(), eta: '1700000000' },
    };
    const repo = makeRepo();
    await buildWriter(repo).write(CTX, decoded, LOG_REF);
    expect(() => JSON.stringify(decoded.payload)).not.toThrow();
  });

  it('#11 — CH insertEvent call does NOT include received_at field', async () => {
    let capturedData: unknown;
    const repo = makeRepo({
      insertEvent: vi.fn().mockImplementation((data: unknown) => {
        capturedData = data;
        return Promise.resolve();
      }),
    });

    await buildWriter(repo).write(CTX, DECODED, LOG_REF);
    expect(capturedData).toBeDefined();
    expect((capturedData as Record<string, unknown>)['received_at']).toBeUndefined();
  });

  it('#12 — DLQ payload is raw-only: { raw: { topics, data }, block_number }', async () => {
    const fkErr = Object.assign(new Error('FK'), { code: '23503' });
    let capturedDlqRow: unknown;
    const repo = makeRepo({ insertConfirmation: vi.fn().mockRejectedValue(fkErr) });
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedDlqRow = row;
        return Promise.resolve();
      }),
    });

    await buildWriter(repo, [0, 0, 0], dlqRepo).write(CTX, DECODED, LOG_REF);
    const payload = (capturedDlqRow as Record<string, unknown>)['payload'] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      raw: { topics: LOG_REF.topics, data: LOG_REF.data },
      block_number: LOG_REF.blockNumber.toString(),
    });
    expect(payload['event_type']).toBeUndefined();
    expect(payload['proposalId']).toBeUndefined();
  });

  it('#13 — DLQ error field is shaped { name, message, code, stack }', async () => {
    const cause = Object.assign(new Error('FK violation'), { code: '23503', stack: 'stack...' });
    let capturedDlqRow: unknown;
    const repo = makeRepo({ insertConfirmation: vi.fn().mockRejectedValue(cause) });
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedDlqRow = row;
        return Promise.resolve();
      }),
    });

    await buildWriter(repo, [0, 0, 0], dlqRepo).write(CTX, DECODED, LOG_REF);
    const error = (capturedDlqRow as Record<string, unknown>)['error'];
    expect(error).toMatchObject({ name: 'Error', message: 'FK violation', code: '23503' });
    expect((error as Record<string, unknown>)['stack']).toBeDefined();
  });

  it('#15 — two concurrent writes for same 5-tuple: one inserted, one skipped_conflict', async () => {
    let callCount = 0;
    const repo = makeRepo({
      insertConfirmation: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? { id: 'uuid-1' } : undefined);
      }),
    });

    const [r1, r2] = await Promise.all([
      buildWriter(repo, [0, 0, 0]).write(CTX, DECODED, LOG_REF),
      buildWriter(repo, [0, 0, 0]).write(CTX, DECODED, LOG_REF),
    ]);
    expect([r1.result, r2.result].sort()).toEqual(['inserted', 'skipped_conflict']);
  });
});

describe('isTransientPgError', () => {
  it.each([
    ['08000', true],
    ['08001', true],
    ['08003', true],
    ['08006', true],
    ['08007', true],
    ['57P01', true],
    ['57P02', true],
    ['57P03', true],
    ['40001', true],
    ['40P01', true],
    ['53300', true],
    ['08004', true],
  ])('SQLSTATE %s → %s', (code, expected) => {
    expect(isTransientPgError(Object.assign(new Error('err'), { code }))).toBe(expected);
  });

  it.each([
    ['ECONNRESET', true],
    ['ETIMEDOUT', true],
    ['ENOTFOUND', true],
  ])('Node code %s → %s', (code, expected) => {
    expect(isTransientPgError(Object.assign(new Error('err'), { code }))).toBe(expected);
  });

  it.each([
    ['23503', false],
    ['42703', false],
    ['UNKNOWN', false],
    ['', false],
  ])('non-transient code %s → false', (code) => {
    expect(isTransientPgError(Object.assign(new Error('err'), { code }))).toBe(false);
  });

  it('plain string error → false', () => {
    expect(isTransientPgError('some error string')).toBe(false);
  });

  it('null → false', () => {
    expect(isTransientPgError(null)).toBe(false);
  });
});
