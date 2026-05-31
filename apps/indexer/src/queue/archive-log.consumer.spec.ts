import { describe, expect, it, vi } from 'vitest';
import { DecodeError } from '@sources/compound';
import type { ArchiveConsumeFn, RawLogJob } from '@sources/core';
import { ArchiveLogConsumer } from './archive-log.consumer';

const CHAIN_ID = '0x1';
const ADDRESS = '0x' + 'ab'.repeat(20);

const RAW_JOB: RawLogJob = {
  chainId: CHAIN_ID,
  address: ADDRESS,
  txHash: '0x' + 'cc'.repeat(32),
  logIndex: 1,
  blockNumber: '100',
  blockHash: '0x' + 'dd'.repeat(32),
  topics: ['0x' + 'ee'.repeat(32)],
  data: '0x',
  receivedAt: new Date(),
};

function makeConsumer(
  overrides: {
    resolveResult?: ReturnType<typeof makeCtx> | null;
    consumeFn?: ArchiveConsumeFn;
  } = {},
) {
  const ctx = 'resolveResult' in overrides ? overrides.resolveResult : makeCtx();
  const consumeFn = overrides.consumeFn ?? vi.fn().mockResolvedValue(undefined);
  const consumers = new Map<string, ArchiveConsumeFn>(ctx ? [[ctx.sourceType, consumeFn]] : []);
  const queue = { work: vi.fn(), getQueueStats: vi.fn(), getOldestJobAgeSeconds: vi.fn() };
  const dlqRepo = { insert: vi.fn().mockResolvedValue(undefined) };
  const resolver = {
    resolve: vi.fn().mockReturnValue(ctx),
    rebuild: vi.fn().mockResolvedValue(undefined),
  };
  const consumer = new ArchiveLogConsumer(
    queue as never,
    resolver as never,
    consumers,
    dlqRepo as never,
  );
  return { consumer, queue, dlqRepo, resolver, consumeFn };
}

function makeCtx() {
  return {
    sourceType: 'compound_governor_bravo',
    daoSourceId: 'src-1',
    sourceLabel: 'compound_governor_bravo',
    chainId: CHAIN_ID,
  };
}

describe('ArchiveLogConsumer', () => {
  it('registers a work handler on bootstrap', async () => {
    const { consumer, queue } = makeConsumer();
    await consumer.onApplicationBootstrap();
    expect(queue.work).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('processes a job successfully via the registered handler', async () => {
    const { consumer, queue, consumeFn } = makeConsumer();
    await consumer.onApplicationBootstrap();

    // Invoke the registered work handler directly
    const handler = (queue.work as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as (
      jobs: { data: RawLogJob }[],
    ) => Promise<void>;
    await handler([{ data: RAW_JOB }]);

    expect(consumeFn).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'compound_governor_bravo' }),
      RAW_JOB,
    );
  });

  it('rebuilds resolver and sends to DLQ when address is still unmapped after rebuild', async () => {
    const { consumer, queue, dlqRepo, resolver } = makeConsumer({ resolveResult: null });
    await consumer.onApplicationBootstrap();

    const handler = (queue.work as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as (
      jobs: { data: RawLogJob }[],
    ) => Promise<void>;
    await handler([{ data: RAW_JOB }]);

    expect(resolver.rebuild).toHaveBeenCalled();
    expect(dlqRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'archive_unmapped' }),
    );
  });

  it('sends to DLQ when ctx resolves but no consumer is registered for source_type', async () => {
    const ctx = makeCtx();
    const consumers = new Map<string, ArchiveConsumeFn>(); // no consumer for sourceType
    const queue = { work: vi.fn(), getQueueStats: vi.fn(), getOldestJobAgeSeconds: vi.fn() };
    const dlqRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    const resolver = { resolve: vi.fn().mockReturnValue(ctx), rebuild: vi.fn() };
    const consumer = new ArchiveLogConsumer(
      queue as never,
      resolver as never,
      consumers,
      dlqRepo as never,
    );

    await consumer.onApplicationBootstrap();
    const handler = (queue.work as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as (
      jobs: { data: RawLogJob }[],
    ) => Promise<void>;
    await handler([{ data: RAW_JOB }]);

    expect(dlqRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'archive_unmapped' }),
    );
  });

  it('sends to decode DLQ and acks when consume throws DecodeError', async () => {
    const decodeErr = new DecodeError('parse_failed', new Error('bad data'), {
      txHash: RAW_JOB.txHash,
      logIndex: RAW_JOB.logIndex,
      blockHash: RAW_JOB.blockHash,
    });
    const consumeFn = vi.fn().mockRejectedValue(decodeErr);
    const { consumer, queue, dlqRepo } = makeConsumer({ consumeFn });

    await consumer.onApplicationBootstrap();
    const handler = (queue.work as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as (
      jobs: { data: RawLogJob }[],
    ) => Promise<void>;
    await handler([{ data: RAW_JOB }]);

    expect(dlqRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'archive_decode' }),
    );
  });

  it('throws transient errors so pg-boss retries them', async () => {
    const transientErr = new Error('CH write failed');
    const consumeFn = vi.fn().mockRejectedValue(transientErr);
    const { consumer, queue } = makeConsumer({ consumeFn });

    await consumer.onApplicationBootstrap();
    const handler = (queue.work as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as (
      jobs: { data: RawLogJob }[],
    ) => Promise<void>;

    await expect(handler([{ data: RAW_JOB }])).rejects.toThrow('CH write failed');
  });

  it('resolves on second attempt after rebuild when address maps on retry', async () => {
    const ctx = makeCtx();
    const consumeFn = vi.fn().mockResolvedValue(undefined);
    const consumers = new Map([[ctx.sourceType, consumeFn]]);
    const queue = { work: vi.fn(), getQueueStats: vi.fn(), getOldestJobAgeSeconds: vi.fn() };
    const dlqRepo = { insert: vi.fn() };
    let resolveCallCount = 0;
    const resolver = {
      resolve: vi.fn().mockImplementation(() => {
        resolveCallCount++;
        return resolveCallCount === 1 ? undefined : ctx; // first miss, then hit after rebuild
      }),
      rebuild: vi.fn().mockResolvedValue(undefined),
    };
    const consumer = new ArchiveLogConsumer(
      queue as never,
      resolver as never,
      consumers,
      dlqRepo as never,
    );

    await consumer.onApplicationBootstrap();
    const handler = (queue.work as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as (
      jobs: { data: RawLogJob }[],
    ) => Promise<void>;
    await handler([{ data: RAW_JOB }]);

    expect(resolver.rebuild).toHaveBeenCalled();
    expect(consumeFn).toHaveBeenCalled();
    expect(dlqRepo.insert).not.toHaveBeenCalled();
  });
});
