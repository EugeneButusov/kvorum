import { describe, expect, it, vi } from 'vitest';
import type { RawLogJob } from '@sources/core';
import { ArchiveLogDlqBridge } from './archive-log-dlq.bridge';

const RAW_JOB: RawLogJob = {
  chainId: '0x1',
  address: '0x' + 'ab'.repeat(20),
  txHash: '0x' + 'cc'.repeat(32),
  logIndex: 1,
  blockNumber: '100',
  blockHash: '0x' + 'dd'.repeat(32),
  topics: ['0x' + 'ee'.repeat(32)],
  data: '0x',
  receivedAt: new Date(),
};

describe('ArchiveLogDlqBridge', () => {
  it('registers a work handler on bootstrap', async () => {
    const queue = { work: vi.fn() };
    const dlqRepo = { insert: vi.fn() };
    const bridge = new ArchiveLogDlqBridge(queue as never, dlqRepo as never);

    await bridge.onApplicationBootstrap();

    expect(queue.work).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('inserts a DLQ row for each dead-lettered job', async () => {
    const queue = { work: vi.fn() };
    const dlqRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    const bridge = new ArchiveLogDlqBridge(queue as never, dlqRepo as never);

    await bridge.onApplicationBootstrap();

    const handler = (queue.work as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as (
      jobs: { id: string; data: RawLogJob }[],
    ) => Promise<void>;
    await handler([{ id: 'job-123', data: RAW_JOB }]);

    expect(dlqRepo.insert).toHaveBeenCalledOnce();
    const inserted = (dlqRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      stage: string;
      archive_tx_hash: string;
    };
    expect(inserted.stage).toBe('archive_log');
    expect(inserted.archive_tx_hash).toBe(RAW_JOB.txHash);
  });
});
