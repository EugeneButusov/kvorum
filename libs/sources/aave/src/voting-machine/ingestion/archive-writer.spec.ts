import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import { AaveVotingMachineArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer.types';
import type { AaveVotingMachineEvent } from '../domain/types';
import type { AaveVotingMachineEventRepository } from '../persistence/event-repository';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_voting_machine',
  chainId: '0x89',
  sourceLabel: 'aave_voting_machine',
};

const DECODED: AaveVotingMachineEvent = {
  type: 'VoteEmitted',
  payload: {
    proposalId: '123',
    voter: '0xabcdef1234567890abcdef1234567890abcdef12',
    support: true,
    votingPower: '456',
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'aave_voting_machine',
  chainId: '0x89',
  blockNumber: 69000000n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  txIndex: 0,
  logIndex: 0,
  address: '0x44c8b753229006a8047a05b90379a7e92185e97c',
  topics: ['0x0c611e7b6ae0de26f4772260e1bbdb5f58cbb7c275fe2de14671968d29add8d6'],
  data: '0x' + '12'.repeat(32),
};

function makeEventRepo(
  overrides: Partial<{ insert: ReturnType<typeof vi.fn> }> = {},
): AaveVotingMachineEventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AaveVotingMachineEventRepository;
}

function makeArchiveEventRepo(
  overrides: Partial<{
    find: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  }> = {},
): ArchiveEventRepository {
  return {
    find: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue({ id: 'uuid-1' }),
    ...overrides,
  } as unknown as ArchiveEventRepository;
}

function makeDlqRepo(overrides: Partial<{ insert: ReturnType<typeof vi.fn> }> = {}): DlqRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DlqRepository;
}

function buildWriter(
  overrides: {
    eventRepo?: AaveVotingMachineEventRepository;
    archiveEventRepo?: ArchiveEventRepository;
    dlqRepo?: DlqRepository;
  } = {},
): AaveVotingMachineArchiveWriter {
  return new AaveVotingMachineArchiveWriter({
    eventRepo: overrides.eventRepo ?? makeEventRepo(),
    archiveEventRepo: overrides.archiveEventRepo ?? makeArchiveEventRepo(),
    dlqRepo: overrides.dlqRepo ?? makeDlqRepo(),
    logger: silentLogger,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
}

describe('AaveVotingMachineArchiveWriter', () => {
  it('write returns inserted on successful CH+PG archive', async () => {
    const result = await buildWriter().write(CTX, DECODED, LOG_REF);
    expect(result).toEqual({ result: 'inserted' });
  });

  it('writeCore writes CH first, then PG, without received_at in CH payload', async () => {
    const order: string[] = [];
    let chData: unknown;
    const eventRepo = makeEventRepo({
      insert: vi.fn().mockImplementation((data: unknown) => {
        order.push('ch');
        chData = data;
        return Promise.resolve();
      }),
    });
    const archiveEventRepo = makeArchiveEventRepo({
      insert: vi.fn().mockImplementation(() => {
        order.push('pg');
        return Promise.resolve({ id: 'uuid-1' });
      }),
    });

    await buildWriter({ eventRepo, archiveEventRepo }).writeCore(CTX, DECODED, LOG_REF);

    expect(order).toEqual(['ch', 'pg']);
    expect((chData as Record<string, unknown>)['received_at']).toBeUndefined();
  });

  it('uses the default now() when none is injected', async () => {
    const archiveEventRepo = makeArchiveEventRepo();
    const writer = new AaveVotingMachineArchiveWriter({
      eventRepo: makeEventRepo(),
      archiveEventRepo,
      dlqRepo: makeDlqRepo(),
      logger: silentLogger,
    });

    await writer.writeCore(CTX, DECODED, LOG_REF);
    expect(archiveEventRepo.insert).toHaveBeenCalledOnce();
  });

  it('writeCore propagates CH failures and does not write PG', async () => {
    const archiveEventRepo = makeArchiveEventRepo();
    const writer = buildWriter({
      eventRepo: makeEventRepo({ insert: vi.fn().mockRejectedValue(new Error('ch down')) }),
      archiveEventRepo,
    });

    await expect(writer.writeCore(CTX, DECODED, LOG_REF)).rejects.toThrow('ch down');
    expect(archiveEventRepo.insert).not.toHaveBeenCalled();
  });

  it('write short-circuits when archive_event already exists', async () => {
    const eventRepo = makeEventRepo();
    const archiveEventRepo = makeArchiveEventRepo({
      find: vi.fn().mockResolvedValue({ id: 'existing' }),
    });

    const result = await buildWriter({ eventRepo, archiveEventRepo }).write(CTX, DECODED, LOG_REF);

    expect(result).toEqual({ result: 'skipped_existing' });
    expect(eventRepo.insert).not.toHaveBeenCalled();
    expect(archiveEventRepo.insert).not.toHaveBeenCalled();
  });

  it('write routes failures to archive_event_stage DLQ', async () => {
    let captured: unknown;
    const dlqRepo = makeDlqRepo({
      insert: vi.fn().mockImplementation((row: unknown) => {
        captured = row;
        return Promise.resolve();
      }),
    });
    const result = await buildWriter({
      archiveEventRepo: makeArchiveEventRepo({
        insert: vi.fn().mockRejectedValue(new Error('pg error')),
      }),
      dlqRepo,
    }).write(CTX, DECODED, LOG_REF);

    expect(result).toEqual({ result: 'dlq_routed' });
    expect((captured as Record<string, unknown>)['stage']).toBe('archive_event_stage');
  });

  it('write returns unreachable when the DLQ insert also fails', async () => {
    const result = await buildWriter({
      archiveEventRepo: makeArchiveEventRepo({
        insert: vi.fn().mockRejectedValue(new Error('pg error')),
      }),
      dlqRepo: makeDlqRepo({
        insert: vi.fn().mockRejectedValue(new Error('dlq down')),
      }),
    }).write(CTX, DECODED, LOG_REF);

    expect(result).toEqual({ result: 'unreachable' });
  });
});
