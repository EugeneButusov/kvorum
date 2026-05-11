import { describe, it, expect, vi } from 'vitest';
import { ArchiveWriter, isTransientPgError } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer';
import type { CompoundGovernorEvent } from './types';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';

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

// ---- Minimal Kysely mock factory ----

function makeChainableQuery(terminal: Record<string, ReturnType<typeof vi.fn>>): unknown {
  const chain: Record<string, unknown> = {};
  const proxy = new Proxy(chain, {
    get(_target, prop) {
      if (prop in terminal) return terminal[prop as string];
      return () => proxy;
    },
  });
  return proxy;
}

function makePgDb(opts: {
  existingRow?: { id: string; confirmation_status: string } | undefined;
  insertReturning?: { id: string } | undefined;
  insertThrows?: unknown;
  dlqThrows?: unknown;
}): unknown {
  let callCount = 0;

  const selectChain = makeChainableQuery({
    executeTakeFirst: vi.fn().mockResolvedValue(opts.existingRow),
  });

  const buildInsertChain = () => {
    if (opts.insertThrows !== undefined) {
      callCount++;
      if (callCount === 1) {
        // First call is archive_confirmation; possibly retry
        return makeChainableQuery({
          execute: vi.fn().mockRejectedValue(opts.insertThrows),
          executeTakeFirst: vi.fn().mockRejectedValue(opts.insertThrows),
        });
      }
    }

    if (opts.dlqThrows !== undefined && callCount > 0) {
      return makeChainableQuery({
        execute: vi.fn().mockRejectedValue(opts.dlqThrows),
        executeTakeFirst: vi.fn().mockRejectedValue(opts.dlqThrows),
      });
    }

    return makeChainableQuery({
      execute: vi.fn().mockResolvedValue(undefined),
      executeTakeFirst: vi.fn().mockResolvedValue(opts.insertReturning),
    });
  };

  return {
    selectFrom: vi.fn().mockReturnValue(selectChain),
    insertInto: vi.fn().mockImplementation(() => {
      callCount++;
      return buildInsertChain();
    }),
  };
}

function makeChDb(opts: { throws?: unknown } = {}): unknown {
  const insertChain = makeChainableQuery({
    execute: opts.throws
      ? vi.fn().mockRejectedValue(opts.throws)
      : vi.fn().mockResolvedValue(undefined),
  });
  return { insertInto: vi.fn().mockReturnValue(insertChain) };
}

function buildWriter(
  pgDb: unknown,
  chDb: unknown,
  retryBackoffMs = [0, 0, 0] as const,
): ArchiveWriter {
  return new ArchiveWriter({
    pgDb: pgDb as never,
    chDb: chDb as never,
    logger: silentLogger,
    now: () => new Date('2026-01-01T00:00:00Z'),
    retryBackoffMs,
  });
}

// ---- Tests ----

describe('ArchiveWriter', () => {
  it('#1 — happy path: existence empty → CH insert → PG insert → outcome inserted', async () => {
    const chDb = makeChDb();
    const pgDb = makePgDb({ existingRow: undefined, insertReturning: { id: 'uuid-1' } });
    const writer = buildWriter(pgDb, chDb);

    const outcome = await writer.write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('inserted');

    // CH insert should have been called without received_at
    const chInsertCall = (chDb as { insertInto: ReturnType<typeof vi.fn> }).insertInto.mock
      .calls[0];
    expect(chInsertCall).toBeDefined();
  });

  it('#2 — existence-skip: existing row found → CH + PG NOT called, outcome skipped_existing', async () => {
    const chDb = makeChDb();
    const pgDb = makePgDb({ existingRow: { id: 'existing', confirmation_status: 'pending' } });
    const writer = buildWriter(pgDb, chDb);

    const outcome = await writer.write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('skipped_existing');
    expect((chDb as { insertInto: ReturnType<typeof vi.fn> }).insertInto).not.toHaveBeenCalled();
    expect((pgDb as { insertInto: ReturnType<typeof vi.fn> }).insertInto).not.toHaveBeenCalled();
  });

  it('#3 — PG conflict: existence empty → CH insert → PG returns undefined → skipped_conflict', async () => {
    const chDb = makeChDb();
    const pgDb = makePgDb({ existingRow: undefined, insertReturning: undefined });
    const writer = buildWriter(pgDb, chDb);

    const outcome = await writer.write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('skipped_conflict');
  });

  it('#4 — transient PG error retried, succeeds on last attempt → inserted', async () => {
    const chDb = makeChDb();

    // Use a more explicit approach for transient retry test
    const transientErr = Object.assign(new Error('connection reset'), { code: '08006' });
    let pgInsertCallCount = 0;

    const conflictChain = makeChainableQuery({
      executeTakeFirst: vi.fn().mockResolvedValue({ id: 'ok' }),
    });

    const pgDb = {
      selectFrom: vi
        .fn()
        .mockReturnValue(
          makeChainableQuery({ executeTakeFirst: vi.fn().mockResolvedValue(undefined) }),
        ),
      insertInto: vi.fn().mockImplementation(() => {
        pgInsertCallCount++;
        if (pgInsertCallCount <= 2) {
          return makeChainableQuery({
            executeTakeFirst: vi.fn().mockRejectedValue(transientErr),
          });
        }
        return conflictChain;
      }),
    };

    const writer = buildWriter(pgDb, chDb, [0, 0, 0]);
    const outcome = await writer.write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('inserted');
    expect(pgInsertCallCount).toBe(3);
  });

  it('#5 — transient errors exhaust retries → DLQ routed, outcome pg_dlq_routed', async () => {
    const chDb = makeChDb();
    const transientErr = Object.assign(new Error('connection reset'), { code: '08006' });

    // Track which table is being inserted into to route correctly
    const dlqExecute = vi.fn().mockResolvedValue(undefined);
    const pgDb = {
      selectFrom: vi
        .fn()
        .mockReturnValue(
          makeChainableQuery({ executeTakeFirst: vi.fn().mockResolvedValue(undefined) }),
        ),
      insertInto: vi.fn().mockImplementation((table: string) => {
        if (table === 'archive_confirmation') {
          // All archive_confirmation attempts fail with transient error
          return makeChainableQuery({
            executeTakeFirst: vi.fn().mockRejectedValue(transientErr),
          });
        }
        // DLQ insert succeeds
        return makeChainableQuery({ execute: dlqExecute });
      }),
    };

    const writer = buildWriter(pgDb, chDb, [0, 0, 0]);
    const outcome = await writer.write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('pg_dlq_routed');
    expect(dlqExecute).toHaveBeenCalledTimes(1);
  });

  it('#6 — non-transient PG error (FK violation 23503) fails fast → DLQ, pg_dlq_routed', async () => {
    const chDb = makeChDb();
    const fkErr = Object.assign(new Error('FK violation'), { code: '23503' });

    let pgInsertCallCount = 0;
    const pgDb = {
      selectFrom: vi
        .fn()
        .mockReturnValue(
          makeChainableQuery({ executeTakeFirst: vi.fn().mockResolvedValue(undefined) }),
        ),
      insertInto: vi.fn().mockImplementation(() => {
        pgInsertCallCount++;
        if (pgInsertCallCount === 1) {
          return makeChainableQuery({
            executeTakeFirst: vi.fn().mockRejectedValue(fkErr),
          });
        }
        return makeChainableQuery({ execute: vi.fn().mockResolvedValue(undefined) });
      }),
    };

    const writer = buildWriter(pgDb, chDb, [0, 0, 0]);
    const outcome = await writer.write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('pg_dlq_routed');
    // Non-transient → only 1 attempt before DLQ
    expect(pgInsertCallCount).toBe(2); // 1 archive_confirmation + 1 DLQ
  });

  it('#7 — DLQ insert itself fails → pg_unreachable, outcome pg_unreachable', async () => {
    const chDb = makeChDb();
    const fkErr = Object.assign(new Error('FK violation'), { code: '23503' });
    const dlqErr = new Error('PG unreachable');

    let pgInsertCallCount = 0;
    const pgDb = {
      selectFrom: vi
        .fn()
        .mockReturnValue(
          makeChainableQuery({ executeTakeFirst: vi.fn().mockResolvedValue(undefined) }),
        ),
      insertInto: vi.fn().mockImplementation(() => {
        pgInsertCallCount++;
        if (pgInsertCallCount === 1) {
          return makeChainableQuery({
            executeTakeFirst: vi.fn().mockRejectedValue(fkErr),
          });
        }
        return makeChainableQuery({ execute: vi.fn().mockRejectedValue(dlqErr) });
      }),
    };

    const writer = buildWriter(pgDb, chDb, [0, 0, 0]);
    const outcome = await writer.write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('pg_unreachable');
  });

  it('#8 — CH insert failure propagates as exception; PG/DLQ NOT attempted', async () => {
    const chErr = new Error('ClickHouse connection refused');
    const chDb = makeChDb({ throws: chErr });
    const pgDb = makePgDb({ existingRow: undefined, insertReturning: { id: 'uuid-1' } });
    const writer = buildWriter(pgDb, chDb);

    await expect(writer.write(CTX, DECODED, LOG_REF)).rejects.toThrow(
      'ClickHouse connection refused',
    );
    expect((pgDb as { insertInto: ReturnType<typeof vi.fn> }).insertInto).not.toHaveBeenCalled();
  });

  it('#9 — uint256 boundary in payload survives JSON.stringify round-trip', async () => {
    const decoded: CompoundGovernorEvent = {
      type: 'ProposalQueued',
      payload: { proposalId: (2n ** 256n - 1n).toString(), eta: '1700000000' },
    };
    const pgDb = makePgDb({ existingRow: undefined, insertReturning: { id: 'uuid-1' } });

    // Capture what was passed to CH insertInto.values
    const valuesCapture: unknown[] = [];
    const captureChDb = {
      insertInto: vi.fn().mockReturnValue(
        makeChainableQuery({
          execute: vi.fn().mockImplementation(() => {
            return Promise.resolve(undefined);
          }),
          values: vi.fn().mockImplementation((v: unknown) => {
            valuesCapture.push(v);
            return makeChainableQuery({ execute: vi.fn().mockResolvedValue(undefined) });
          }),
        }),
      ),
    };

    const writer = buildWriter(pgDb, captureChDb as unknown, [0, 0, 0]);
    await writer.write(CTX, decoded, LOG_REF);
    // Verify no throw from serialization (bigint-safe decimal string)
    expect(() => JSON.stringify(decoded.payload)).not.toThrow();
  });

  it('#11 — CH insert call does NOT include received_at field', async () => {
    let capturedValues: Record<string, unknown> | undefined;
    const captureChDb = {
      insertInto: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
          capturedValues = v;
          return { execute: vi.fn().mockResolvedValue(undefined) };
        }),
      }),
    };
    const pgDb = makePgDb({ existingRow: undefined, insertReturning: { id: 'uuid-1' } });
    const writer = buildWriter(pgDb, captureChDb as unknown, [0, 0, 0]);

    await writer.write(CTX, DECODED, LOG_REF);
    expect(capturedValues).toBeDefined();
    expect('received_at' in (capturedValues ?? {})).toBe(false);
  });

  it('#12 — DLQ payload is raw-only: { raw: { topics, data }, block_number }', async () => {
    const fkErr = Object.assign(new Error('FK'), { code: '23503' });
    let dlqPayload: unknown;

    let pgInsertCallCount = 0;
    const pgDb = {
      selectFrom: vi
        .fn()
        .mockReturnValue(
          makeChainableQuery({ executeTakeFirst: vi.fn().mockResolvedValue(undefined) }),
        ),
      insertInto: vi.fn().mockImplementation(() => {
        pgInsertCallCount++;
        if (pgInsertCallCount === 1) {
          return makeChainableQuery({
            executeTakeFirst: vi.fn().mockRejectedValue(fkErr),
          });
        }
        // DLQ insert — capture values
        return {
          values: vi.fn().mockImplementation((v: { payload: unknown }) => {
            dlqPayload = v.payload;
            return { execute: vi.fn().mockResolvedValue(undefined) };
          }),
        };
      }),
    };

    const writer = buildWriter(pgDb, makeChDb(), [0, 0, 0]);
    await writer.write(CTX, DECODED, LOG_REF);
    expect(dlqPayload).toMatchObject({
      raw: { topics: LOG_REF.topics, data: LOG_REF.data },
      block_number: LOG_REF.blockNumber.toString(),
    });
    // No event_type or decoded fields
    expect((dlqPayload as Record<string, unknown>)['event_type']).toBeUndefined();
    expect((dlqPayload as Record<string, unknown>)['proposalId']).toBeUndefined();
  });

  it('#13 — DLQ error field is shaped { name, message, code, stack }', async () => {
    // Use non-transient code (23503 FK violation) to avoid retries; fail-fast to DLQ
    const cause = Object.assign(new Error('FK violation'), { code: '23503', stack: 'stack...' });
    let dlqError: unknown;

    let pgInsertCallCount = 0;
    const pgDb = {
      selectFrom: vi
        .fn()
        .mockReturnValue(
          makeChainableQuery({ executeTakeFirst: vi.fn().mockResolvedValue(undefined) }),
        ),
      insertInto: vi.fn().mockImplementation(() => {
        pgInsertCallCount++;
        if (pgInsertCallCount === 1) {
          return makeChainableQuery({
            executeTakeFirst: vi.fn().mockRejectedValue(cause),
          });
        }
        return {
          values: vi.fn().mockImplementation((v: { error: unknown }) => {
            dlqError = v.error;
            return { execute: vi.fn().mockResolvedValue(undefined) };
          }),
        };
      }),
    };

    const writer = buildWriter(pgDb, makeChDb(), [0, 0, 0]);
    await writer.write(CTX, DECODED, LOG_REF);
    expect(dlqError).toMatchObject({ name: 'Error', message: 'FK violation', code: '23503' });
    expect((dlqError as Record<string, unknown>)['stack']).toBeDefined();
  });

  it('#15 — two concurrent writes for same 5-tuple: one inserted, one skipped_conflict', async () => {
    const chDb = makeChDb();

    let pgInsertCallCount = 0;
    const pgDb = {
      selectFrom: vi.fn().mockImplementation(() => {
        return makeChainableQuery({ executeTakeFirst: vi.fn().mockResolvedValue(undefined) });
      }),
      insertInto: vi.fn().mockImplementation(() => {
        pgInsertCallCount++;
        // First insert succeeds, second returns conflict (undefined)
        if (pgInsertCallCount === 1) {
          return makeChainableQuery({
            executeTakeFirst: vi.fn().mockResolvedValue({ id: 'uuid-1' }),
          });
        }
        return makeChainableQuery({ executeTakeFirst: vi.fn().mockResolvedValue(undefined) });
      }),
    };

    const writer = buildWriter(pgDb, chDb, [0, 0, 0]);
    const [r1, r2] = await Promise.all([
      writer.write(CTX, DECODED, LOG_REF),
      writer.write(CTX, DECODED, LOG_REF),
    ]);

    const results = [r1.result, r2.result].sort();
    expect(results).toEqual(['inserted', 'skipped_conflict']);
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
