import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { SplitDelegationArchiveWriter } from './archive-writer';
import type { SplitDelegationEvent } from '../domain/types';

const LOG: LogEvent = {
  sourceType: 'snapshot_split_delegation',
  chainId: '0x1',
  blockNumber: 200n,
  blockHash: '0xblock',
  txHash: '0xtx',
  txIndex: 0,
  logIndex: 0,
  address: '0xreg',
  topics: [],
  data: '0x',
};

const EVENT: SplitDelegationEvent = {
  type: 'DelegationCleared',
  payload: { account: '0x11', context: 'lido-snapshot.eth' },
};

describe('SplitDelegationArchiveWriter.writeCore', () => {
  it('writes to CH then PG with mapped fields', async () => {
    const eventRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    const archiveEventRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    const writer = new SplitDelegationArchiveWriter({
      eventRepo: eventRepo as never,
      archiveEventRepo: archiveEventRepo as never,
      dlqRepo: {} as never,
      logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    await writer.writeCore(
      {
        daoSourceId: 'src',
        sourceType: 'snapshot_split_delegation',
        chainId: '0x1',
        sourceLabel: 'split',
      },
      EVENT,
      LOG,
    );
    expect(eventRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: '200', eventType: 'DelegationCleared' }),
    );
    expect(archiveEventRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'DelegationCleared' }),
    );
  });
});
