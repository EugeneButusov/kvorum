import { describe, it, expect, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ConfirmationRepository, DlqRepository } from '@libs/db';
import { CompTokenArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from '../../shared';
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

function makeEventRepo(
  overrides: Partial<{ insert: ReturnType<typeof vi.fn> }> = {},
): CompTokenEventRepository {
  return { insert: vi.fn().mockResolvedValue(undefined), ...overrides } as never;
}

function makeConfirmationRepo(
  overrides: Partial<{ find: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> }> = {},
): ConfirmationRepository {
  return {
    find: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue({ id: 'uuid-1' }),
    ...overrides,
  } as never;
}

function makeDlqRepo(overrides: Partial<{ insert: ReturnType<typeof vi.fn> }> = {}): DlqRepository {
  return { insert: vi.fn().mockResolvedValue(undefined), ...overrides } as never;
}

function buildWriter(
  overrides: {
    eventRepo?: CompTokenEventRepository;
    confirmationRepo?: ConfirmationRepository;
    dlqRepo?: DlqRepository;
  } = {},
): CompTokenArchiveWriter {
  return new CompTokenArchiveWriter({
    eventRepo: overrides.eventRepo ?? makeEventRepo(),
    confirmationRepo: overrides.confirmationRepo ?? makeConfirmationRepo(),
    dlqRepo: overrides.dlqRepo ?? makeDlqRepo(),
    logger: silentLogger,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
}

describe('CompTokenArchiveWriter', () => {
  it('writes happy-path and returns inserted', async () => {
    const eventRepo = makeEventRepo();
    const confirmationRepo = makeConfirmationRepo();

    const outcome = await buildWriter({ eventRepo, confirmationRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('inserted');
    expect(eventRepo.insert).toHaveBeenCalledOnce();
    expect(confirmationRepo.insert).toHaveBeenCalledOnce();
  });

  it('skips on existing confirmation', async () => {
    const eventRepo = makeEventRepo();
    const confirmationRepo = makeConfirmationRepo({ find: vi.fn().mockResolvedValue({ id: 'x' }) });

    const outcome = await buildWriter({ eventRepo, confirmationRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('skipped_existing');
    expect(eventRepo.insert).not.toHaveBeenCalled();
    expect(confirmationRepo.insert).not.toHaveBeenCalled();
  });

  it('returns skipped_conflict on ON CONFLICT no-op insert', async () => {
    const confirmationRepo = makeConfirmationRepo({ insert: vi.fn().mockResolvedValue(undefined) });
    const outcome = await buildWriter({ confirmationRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('skipped_conflict');
  });

  it('routes persistent PG confirmation failure to delegation_archive_write DLQ', async () => {
    let capturedDlq: unknown;
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockRejectedValue(new Error('pg')),
    });
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedDlq = row;
        return Promise.resolve();
      }),
    });

    const outcome = await buildWriter({ confirmationRepo, dlqRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('dlq_routed');
    expect((capturedDlq as Record<string, unknown>)['stage']).toBe('delegation_archive_write');
  });

  it('returns unreachable when DLQ write fails', async () => {
    const confirmationRepo = makeConfirmationRepo({
      insert: vi.fn().mockRejectedValue(new Error('pg')),
    });
    const dlqRepo = makeDlqRepo({ insert: vi.fn().mockRejectedValue(new Error('dlq down')) });

    const outcome = await buildWriter({ confirmationRepo, dlqRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('unreachable');
  });

  it('propagates CH archive insert failure', async () => {
    const eventRepo = makeEventRepo({ insert: vi.fn().mockRejectedValue(new Error('ch down')) });
    const confirmationRepo = makeConfirmationRepo();
    const dlqRepo = makeDlqRepo();

    await expect(
      buildWriter({ eventRepo, confirmationRepo, dlqRepo }).write(CTX, DECODED, LOG_REF),
    ).rejects.toThrow('ch down');
    expect(confirmationRepo.insert).not.toHaveBeenCalled();
    expect(dlqRepo.insert).not.toHaveBeenCalled();
  });
});
