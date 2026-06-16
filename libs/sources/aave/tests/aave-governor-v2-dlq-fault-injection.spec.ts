import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { AaveGovernorV2EventRepository } from '@sources/aave';
import { AaveGovernorV2ArchiveWriter, makeAaveGovernorV2IngesterListener } from '@sources/aave';

const V2_CTX = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_governor_v2',
  chainId: '0x1',
  sourceLabel: 'aave_governor_v2',
} as const;

function makeConfirmationRepo(shouldFail: boolean): ArchiveEventRepository {
  return {
    find: vi.fn().mockResolvedValue(undefined),
    insert: shouldFail
      ? vi.fn().mockRejectedValue(new Error('forced pg failure'))
      : vi.fn().mockResolvedValue({ id: 'ok' }),
  } as unknown as ArchiveEventRepository;
}

function makeEventRepo(shouldFail: boolean): AaveGovernorV2EventRepository {
  return {
    insert: shouldFail ? vi.fn().mockRejectedValue(new Error('forced ch failure')) : vi.fn(),
  } as unknown as AaveGovernorV2EventRepository;
}

function makeDlqRepo(capture: Array<{ stage: string }>): DlqRepository {
  return {
    insert: vi.fn().mockImplementation((row: { stage: string }) => {
      capture.push({ stage: row.stage });
      return Promise.resolve(undefined);
    }),
  } as unknown as DlqRepository;
}

function makeProposalCreatedLog(): LogEvent {
  return {
    sourceType: 'aave_governor_v2',
    chainId: '0x1',
    blockNumber: 11_500_000n,
    blockHash: '0x' + 'b1'.repeat(32),
    txHash: '0x' + '1a'.repeat(32),
    txIndex: 0,
    logIndex: 0,
    address: '0xec568fffba86c094cf06b22134b23074dfe2252c',
    // ProposalCreated fixture from governor-v2-proposal-created.json
    topics: [
      '0xd272d67d2c8c66de43c1d2515abb064978a5020c173e15903b6a2ab3bf7440ec',
      '0x0000000000000000000000001111111111111111111111111111111111111111',
      '0x000000000000000000000000a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0',
    ],
    data: '0x000000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000026000000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000000b71b000000000000000000000000000000000000000000000000000000000000b86c80000000000000000000000000c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c012121212121212121212121212121212121212121212121212121212121212120000000000000000000000000000000000000000000000000000000000000001000000000000000000000000b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000026656e61626c65426f72726f77696e674f6e5265736572766528616464726573732c626f6f6c290000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000044eede87c1000000000000000000000000200000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000',
  };
}

describe('Aave governor-v2 DLQ fault injection', () => {
  it('routes CH write failure to aave_governor_v2_archive_write DLQ stage', async () => {
    const dlqRows: Array<{ stage: string }> = [];
    const writer = new AaveGovernorV2ArchiveWriter({
      eventRepo: makeEventRepo(true),
      archiveEventRepo: makeConfirmationRepo(false),
      dlqRepo: makeDlqRepo(dlqRows),
      logger: silentLogger,
    });
    const listener = makeAaveGovernorV2IngesterListener(
      { archiveWriter: writer, context: V2_CTX, logger: silentLogger, dlqRepo: makeDlqRepo([]) },
      { onWriteFailure: 'throw' },
    );

    await listener([makeProposalCreatedLog()]);

    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]!.stage).toBe('aave_governor_v2_archive_write');
  });

  it('routes PG write failure to aave_governor_v2_archive_write DLQ stage', async () => {
    const dlqRows: Array<{ stage: string }> = [];
    const writer = new AaveGovernorV2ArchiveWriter({
      eventRepo: makeEventRepo(false),
      archiveEventRepo: makeConfirmationRepo(true),
      dlqRepo: makeDlqRepo(dlqRows),
      logger: silentLogger,
    });
    const listener = makeAaveGovernorV2IngesterListener(
      { archiveWriter: writer, context: V2_CTX, logger: silentLogger, dlqRepo: makeDlqRepo([]) },
      { onWriteFailure: 'throw' },
    );

    await listener([makeProposalCreatedLog()]);

    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]!.stage).toBe('aave_governor_v2_archive_write');
  });
});
