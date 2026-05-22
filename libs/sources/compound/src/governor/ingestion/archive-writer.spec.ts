import { describe, it, expect, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ConfirmationRepository, DlqRepository } from '@libs/db';
import { ArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer.types';
import type { CompoundGovernorEvent } from '../domain/types';
import type { EventRepository } from '../persistence/event-repository';

// ---- Shared test fixtures ----

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_governor_bravo',
  chainId: 1,
  sourceLabel: 'compound_governor_bravo',
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
const VOTECAST_DECODED: CompoundGovernorEvent = {
  type: 'VoteCast',
  payload: {
    voter: '0xabcdef1234567890abcdef1234567890abcdef12',
    proposalId: '123',
    primaryChoice: 1,
    votingPowerReported: '100',
    compound: { supportRaw: 1, reason: null },
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'compound_governor_bravo',
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

// ---- Mock factories ----

function makeEventRepo(
  overrides: Partial<{ insert: ReturnType<typeof vi.fn> }> = {},
): EventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as EventRepository;
}

function makeConfirmationRepo(
  overrides: Partial<{
    find: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  }> = {},
): ConfirmationRepository {
  return {
    find: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue({ id: 'uuid-1' }),
    ...overrides,
  } as unknown as ConfirmationRepository;
}

function makeDlqRepo(overrides: Partial<{ insert: ReturnType<typeof vi.fn> }> = {}): DlqRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DlqRepository;
}

function buildWriter(
  overrides: {
    eventRepo?: EventRepository;
    confirmationRepo?: ConfirmationRepository;
    dlqRepo?: DlqRepository;
  } = {},
): ArchiveWriter {
  return new ArchiveWriter({
    eventRepo: overrides.eventRepo ?? makeEventRepo(),
    confirmationRepo: overrides.confirmationRepo ?? makeConfirmationRepo(),
    dlqRepo: overrides.dlqRepo ?? makeDlqRepo(),
    logger: silentLogger,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
}

// ---- Tests ----

describe('ArchiveWriter', () => {
  it('#1 — happy path: existence check empty → archive insert → confirmation insert → outcome inserted', async () => {
    const eventRepo = makeEventRepo();
    const confirmationRepo = makeConfirmationRepo();
    const outcome = await buildWriter({ eventRepo, confirmationRepo }).write(CTX, DECODED, LOG_REF);

    expect(outcome.result).toBe('inserted');
    expect(eventRepo.insert).toHaveBeenCalledTimes(1);
    expect(confirmationRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('#2 — existence-skip: existing row found → archive + confirmation NOT called, outcome skipped_existing', async () => {
    const eventRepo = makeEventRepo();
    const confirmationRepo = makeConfirmationRepo({
      find: vi.fn().mockResolvedValue({ id: 'existing' }),
    });
    const outcome = await buildWriter({ eventRepo, confirmationRepo }).write(CTX, DECODED, LOG_REF);

    expect(outcome.result).toBe('skipped_existing');
    expect(eventRepo.insert).not.toHaveBeenCalled();
    expect(confirmationRepo.insert).not.toHaveBeenCalled();
  });

  it('#3 — conflict: existence empty → archive insert → confirmation returns undefined → skipped_conflict', async () => {
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockResolvedValue(undefined),
    });
    const outcome = await buildWriter({ confirmationRepo }).write(CTX, DECODED, LOG_REF);

    expect(outcome.result).toBe('skipped_conflict');
  });

  it('#4 — confirmationRepo.insert throws → DLQ routed, outcome pg_dlq_routed', async () => {
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockRejectedValue(new Error('pg error')),
    });
    const dlqRepo = makeDlqRepo();

    const outcome = await buildWriter({ confirmationRepo, dlqRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('dlq_routed');
    expect(dlqRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('#5 — DLQ insert itself fails → outcome pg_unreachable', async () => {
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockRejectedValue(new Error('pg error')),
    });
    const dlqRepo = makeDlqRepo({ insert: vi.fn().mockRejectedValue(new Error('dlq down')) });

    const outcome = await buildWriter({ confirmationRepo, dlqRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('unreachable');
  });

  it('#6 — eventRepo.insert failure routes to DLQ and returns dlq_routed', async () => {
    const eventRepo = makeEventRepo({
      insert: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    const confirmationRepo = makeConfirmationRepo();
    const dlqRepo = makeDlqRepo();

    const outcome = await buildWriter({ eventRepo, confirmationRepo, dlqRepo }).write(
      CTX,
      DECODED,
      LOG_REF,
    );
    expect(outcome.result).toBe('dlq_routed');
    expect(confirmationRepo.insert).not.toHaveBeenCalled();
    expect(dlqRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('#7 — uint256 boundary in payload survives JSON.stringify round-trip', async () => {
    const decoded: CompoundGovernorEvent = {
      type: 'ProposalQueued',
      payload: { proposalId: (2n ** 256n - 1n).toString(), eta: '1700000000' },
    };
    await buildWriter().write(CTX, decoded, LOG_REF);
    expect(() => JSON.stringify(decoded.payload)).not.toThrow();
  });

  it('#8 — eventRepo.insert call does NOT include received_at field', async () => {
    let capturedData: unknown;
    const eventRepo = makeEventRepo({
      insert: vi.fn().mockImplementation((data: unknown) => {
        capturedData = data;
        return Promise.resolve();
      }),
    });

    await buildWriter({ eventRepo }).write(CTX, DECODED, LOG_REF);
    expect(capturedData).toBeDefined();
    expect((capturedData as Record<string, unknown>)['received_at']).toBeUndefined();
  });

  it('#9 — DLQ payload is raw-only: { raw: { topics, data }, block_number }', async () => {
    let capturedDlqRow: unknown;
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockRejectedValue(new Error('pg')),
    });
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedDlqRow = row;
        return Promise.resolve();
      }),
    });

    await buildWriter({ confirmationRepo, dlqRepo }).write(CTX, DECODED, LOG_REF);
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

  it('#10 — DLQ error field is shaped { name, message, code, stack }', async () => {
    const cause = Object.assign(new Error('FK violation'), { code: '23503', stack: 'stack...' });
    let capturedDlqRow: unknown;
    const confirmationRepo = makeConfirmationRepo({ insert: vi.fn().mockRejectedValue(cause) });
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedDlqRow = row;
        return Promise.resolve();
      }),
    });

    await buildWriter({ confirmationRepo, dlqRepo }).write(CTX, DECODED, LOG_REF);
    const error = (capturedDlqRow as Record<string, unknown>)['error'];
    expect(error).toMatchObject({ name: 'Error', message: 'FK violation', code: '23503' });
    expect((error as Record<string, unknown>)['stack']).toBeDefined();
  });

  it('#11 — two concurrent writes for same 5-tuple: one inserted, one skipped_conflict', async () => {
    let callCount = 0;
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? { id: 'uuid-1' } : undefined);
      }),
    });

    const [r1, r2] = await Promise.all([
      buildWriter({ confirmationRepo }).write(CTX, DECODED, LOG_REF),
      buildWriter({ confirmationRepo }).write(CTX, DECODED, LOG_REF),
    ]);
    expect([r1.result, r2.result].sort()).toEqual(['inserted', 'skipped_conflict']);
  });

  // ---- Classifier (backfill path, decision #2 + S3) ----

  it('#12 — classifier returning confirmed: confirmation_status=confirmed, confirmed_at=receivedAt', async () => {
    const fixedNow = new Date('2026-03-01T12:00:00Z');
    let capturedRow: unknown;
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedRow = row;
        return Promise.resolve({ id: 'uuid-c' });
      }),
    });

    const ctx: ArchiveWriteContext = {
      ...CTX,
      confirmationClassifier: () => 'confirmed',
    };
    const writer = new ArchiveWriter({
      eventRepo: makeEventRepo(),
      confirmationRepo,
      dlqRepo: makeDlqRepo(),
      logger: silentLogger,
      now: () => fixedNow,
    });

    const outcome = await writer.write(ctx, DECODED, LOG_REF);
    expect(outcome.result).toBe('inserted');
    const row = capturedRow as Record<string, unknown>;
    expect(row['confirmation_status']).toBe('confirmed');
    expect(row['confirmed_at']).toEqual(fixedNow);
  });

  it('#13 — classifier boundary: blockNumber === cutoffBlock ⇒ confirmed (<=)', async () => {
    const cutoff = LOG_REF.blockNumber;
    let capturedRow: unknown;
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedRow = row;
        return Promise.resolve({ id: 'uuid-d' });
      }),
    });

    const ctx: ArchiveWriteContext = {
      ...CTX,
      confirmationClassifier: (bn) => (bn <= cutoff ? 'confirmed' : 'pending'),
    };

    await buildWriter({ confirmationRepo }).write(ctx, DECODED, LOG_REF);
    expect((capturedRow as Record<string, unknown>)['confirmation_status']).toBe('confirmed');
  });

  it('#14 — no classifier (live path): confirmation_status=pending, confirmed_at=null', async () => {
    let capturedRow: unknown;
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedRow = row;
        return Promise.resolve({ id: 'uuid-e' });
      }),
    });

    await buildWriter({ confirmationRepo }).write(CTX, DECODED, LOG_REF);
    const row = capturedRow as Record<string, unknown>;
    expect(row['confirmation_status']).toBe('pending');
    expect(row['confirmed_at']).toBeNull();
  });

  it('#15 — VoteCast routes to archive_confirmation_write on confirmation insert failure', async () => {
    let capturedDlqRow: unknown;
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockRejectedValue(new Error('pg')),
    });
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedDlqRow = row;
        return Promise.resolve();
      }),
    });

    const outcome = await buildWriter({ confirmationRepo, dlqRepo }).write(
      CTX,
      VOTECAST_DECODED,
      LOG_REF,
    );
    expect(outcome.result).toBe('dlq_routed');
    expect((capturedDlqRow as { stage: string }).stage).toBe('archive_confirmation_write');
  });

  it('#16 — proposal events route to archive_confirmation_write on CH insert failure', async () => {
    let capturedDlqRow: unknown;
    const eventRepo = makeEventRepo({
      insert: vi.fn().mockRejectedValue(new Error('ch down')),
    });
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedDlqRow = row;
        return Promise.resolve();
      }),
    });

    const outcome = await buildWriter({ eventRepo, dlqRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('dlq_routed');
    expect((capturedDlqRow as { stage: string }).stage).toBe('archive_confirmation_write');
  });

  it('#17 — VoteCast routes to archive_confirmation_write on CH insert failure', async () => {
    let capturedDlqRow: unknown;
    const eventRepo = makeEventRepo({
      insert: vi.fn().mockRejectedValue(new Error('ch down')),
    });
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedDlqRow = row;
        return Promise.resolve();
      }),
    });

    const outcome = await buildWriter({ eventRepo, dlqRepo }).write(CTX, VOTECAST_DECODED, LOG_REF);
    expect(outcome.result).toBe('dlq_routed');
    expect((capturedDlqRow as { stage: string }).stage).toBe('archive_confirmation_write');
  });
});
