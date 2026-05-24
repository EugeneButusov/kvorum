import { describe, it, expect, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
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

function makeArchiveEventRepo(
  overrides: Partial<{ find: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> }> = {},
): ArchiveEventRepository {
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
    archiveEventRepo?: ArchiveEventRepository;
    dlqRepo?: DlqRepository;
  } = {},
): CompTokenArchiveWriter {
  return new CompTokenArchiveWriter({
    eventRepo: overrides.eventRepo ?? makeEventRepo(),
    archiveEventRepo: overrides.archiveEventRepo ?? makeArchiveEventRepo(),
    dlqRepo: overrides.dlqRepo ?? makeDlqRepo(),
    logger: silentLogger,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
}

describe('CompTokenArchiveWriter', () => {
  it('writes happy-path and returns inserted', async () => {
    const eventRepo = makeEventRepo();
    const archiveEventRepo = makeArchiveEventRepo();

    const outcome = await buildWriter({ eventRepo, archiveEventRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('inserted');
    expect(eventRepo.insert).toHaveBeenCalledOnce();
    expect(archiveEventRepo.insert).toHaveBeenCalledOnce();
  });

  it('skips on existing confirmation', async () => {
    const eventRepo = makeEventRepo();
    const archiveEventRepo = makeArchiveEventRepo({ find: vi.fn().mockResolvedValue({ id: 'x' }) });

    const outcome = await buildWriter({ eventRepo, archiveEventRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('skipped_existing');
    expect(eventRepo.insert).not.toHaveBeenCalled();
    expect(archiveEventRepo.insert).not.toHaveBeenCalled();
  });

  it('returns skipped_conflict on ON CONFLICT no-op insert', async () => {
    const archiveEventRepo = makeArchiveEventRepo({ insert: vi.fn().mockResolvedValue(undefined) });
    const outcome = await buildWriter({ archiveEventRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('skipped_conflict');
  });

  it('routes persistent PG confirmation failure to delegation_archive_stage DLQ', async () => {
    let capturedDlq: unknown;
    const archiveEventRepo = makeArchiveEventRepo({
      insert: vi.fn().mockRejectedValue(new Error('pg')),
    });
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        capturedDlq = row;
        return Promise.resolve();
      }),
    });

    const outcome = await buildWriter({ archiveEventRepo, dlqRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('dlq_routed');
    expect((capturedDlq as Record<string, unknown>)['stage']).toBe('delegation_archive_stage');
  });

  it('returns unreachable when DLQ write fails', async () => {
    const archiveEventRepo = makeArchiveEventRepo({
      insert: vi.fn().mockRejectedValue(new Error('pg')),
    });
    const dlqRepo = makeDlqRepo({ insert: vi.fn().mockRejectedValue(new Error('dlq down')) });

    const outcome = await buildWriter({ archiveEventRepo, dlqRepo }).write(CTX, DECODED, LOG_REF);
    expect(outcome.result).toBe('unreachable');
  });

  it('routes CH archive insert failure to delegation_archive_stage DLQ', async () => {
    const eventRepo = makeEventRepo({ insert: vi.fn().mockRejectedValue(new Error('ch down')) });
    const archiveEventRepo = makeArchiveEventRepo();
    const dlqRepo = makeDlqRepo();

    const outcome = await buildWriter({ eventRepo, archiveEventRepo, dlqRepo }).write(
      CTX,
      DECODED,
      LOG_REF,
    );
    expect(outcome.result).toBe('dlq_routed');
    expect(archiveEventRepo.insert).not.toHaveBeenCalled();
    expect(dlqRepo.insert).toHaveBeenCalledOnce();
    expect(dlqRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'delegation_archive_stage' }),
    );
  });

  it('returns unreachable when CH archive insert and DLQ write both fail', async () => {
    const eventRepo = makeEventRepo({ insert: vi.fn().mockRejectedValue(new Error('ch down')) });
    const archiveEventRepo = makeArchiveEventRepo();
    const dlqRepo = makeDlqRepo({ insert: vi.fn().mockRejectedValue(new Error('dlq down')) });

    const outcome = await buildWriter({ eventRepo, archiveEventRepo, dlqRepo }).write(
      CTX,
      DECODED,
      LOG_REF,
    );
    expect(outcome.result).toBe('unreachable');
    expect(archiveEventRepo.insert).not.toHaveBeenCalled();
    expect(dlqRepo.insert).toHaveBeenCalledOnce();
  });
});
