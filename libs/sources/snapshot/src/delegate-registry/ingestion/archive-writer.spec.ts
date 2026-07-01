import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DelegateRegistryArchiveWriter } from './archive-writer';
import type { DelegateRegistryEvent } from '../domain/types';

const LOG: LogEvent = {
  sourceType: 'snapshot_delegate_registry',
  chainId: '0x1',
  blockNumber: 100n,
  blockHash: '0xblock',
  txHash: '0xtx',
  txIndex: 0,
  logIndex: 2,
  address: '0xreg',
  topics: [],
  data: '0x',
};

const EVENT: DelegateRegistryEvent = {
  type: 'SetDelegate',
  payload: { delegator: '0x11', id: '0x00', delegate: '0x22' },
};

describe('DelegateRegistryArchiveWriter.writeCore', () => {
  it('writes to CH then PG with mapped fields', async () => {
    const eventRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    const archiveEventRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    const writer = new DelegateRegistryArchiveWriter({
      eventRepo: eventRepo as never,
      archiveEventRepo: archiveEventRepo as never,
      dlqRepo: {} as never,
      logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    await writer.writeCore(
      {
        daoSourceId: 'src',
        sourceType: 'snapshot_delegate_registry',
        chainId: '0x1',
        sourceLabel: 'reg',
      },
      EVENT,
      LOG,
    );
    expect(eventRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: '100', logIndex: 2, eventType: 'SetDelegate' }),
    );
    expect(archiveEventRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'snapshot_delegate_registry',
        event_type: 'SetDelegate',
      }),
    );
  });
});
