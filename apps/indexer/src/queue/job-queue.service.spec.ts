import { PgBoss } from 'pg-boss';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeArchiveProducer } from '@sources/core';
import { JobQueueService } from './job-queue.service';
import { ARCHIVE_LOG_QUEUE, ARCHIVE_LOG_DLQ_QUEUE } from './queue-names';

const { mockBoss, mockProducer, mockExecuteQuery } = vi.hoisted(() => {
  const mockExecuteQuery = vi.fn().mockResolvedValue({ rows: [{ oldest_seconds: 42 }] });
  return {
    mockBoss: {
      on: vi.fn(),
      start: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
      createQueue: vi.fn<[string, object?], Promise<void>>().mockResolvedValue(undefined),
      send: vi.fn<[], Promise<string>>().mockResolvedValue('job-id'),
      stop: vi.fn<[object?], Promise<void>>().mockResolvedValue(undefined),
      work: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
      getQueueStats: vi.fn().mockResolvedValue({ queuedCount: 3 }),
    },
    mockProducer: vi.fn(),
    mockExecuteQuery,
  };
});

vi.mock('pg-boss', () => ({
  PgBoss: vi.fn().mockImplementation(function () {
    return mockBoss;
  }),
  fromKysely: vi.fn().mockReturnValue('kysely-db-adapter'),
}));

vi.mock('@libs/db', () => ({
  pgDb: {
    getExecutor: vi.fn().mockReturnValue({
      executeQuery: mockExecuteQuery,
      transformQuery: vi.fn().mockImplementation((n: unknown) => n),
      compileQuery: vi
        .fn()
        .mockReturnValue({ sql: 'SELECT 1', parameters: [], queryId: { queryId: '1' } }),
    }),
  },
  SeenLogRepository: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@sources/core', () => ({
  makeArchiveProducer: vi.fn().mockReturnValue(mockProducer),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockBoss.start.mockResolvedValue(undefined);
  mockBoss.createQueue.mockResolvedValue(undefined);
  mockBoss.stop.mockResolvedValue(undefined);
  mockBoss.work.mockResolvedValue(undefined);
  mockBoss.getQueueStats.mockResolvedValue({ queuedCount: 3 });
  mockExecuteQuery.mockResolvedValue({ rows: [{ oldest_seconds: 42 }] });
  vi.mocked(makeArchiveProducer).mockReturnValue(mockProducer);
});

describe('JobQueueService', () => {
  describe('constructor', () => {
    it('builds the listener immediately via makeArchiveProducer', () => {
      const provider = new JobQueueService();

      expect(makeArchiveProducer).toHaveBeenCalledOnce();
      expect(provider.listener).toBe(mockProducer);
    });

    it('listener enqueue closure sends to the correct queue via boss', async () => {
      const provider = new JobQueueService();
      await provider.onApplicationBootstrap(); // starts boss

      const deps = vi.mocked(makeArchiveProducer).mock.calls[0]![0];
      const fakeJob = { chainId: '0x1' } as never;
      await deps.enqueue(fakeJob, {} as never);

      expect(mockBoss.send).toHaveBeenCalledWith(ARCHIVE_LOG_QUEUE, fakeJob, expect.any(Object));
    });
  });

  describe('onApplicationBootstrap()', () => {
    it('constructs PgBoss with migrate:false and starts it', async () => {
      const provider = new JobQueueService();
      await provider.onApplicationBootstrap();

      expect(PgBoss).toHaveBeenCalledWith(
        expect.objectContaining({ migrate: false, schema: 'pgboss' }),
      );
      expect(mockBoss.start).toHaveBeenCalledOnce();
    });

    it('creates DLQ queue before main queue (deadLetter requires it to exist first)', async () => {
      const provider = new JobQueueService();
      await provider.onApplicationBootstrap();

      const calls = mockBoss.createQueue.mock.calls;
      expect(calls[0]![0]).toBe(ARCHIVE_LOG_DLQ_QUEUE);
      expect(calls[1]![0]).toBe(ARCHIVE_LOG_QUEUE);
      expect(calls[1]![1]).toMatchObject({
        retryLimit: 5,
        retryBackoff: true,
        deadLetter: ARCHIVE_LOG_DLQ_QUEUE,
      });
    });
  });

  describe('work()', () => {
    it('waits for readyPromise then delegates to boss.work', async () => {
      const provider = new JobQueueService();
      await provider.onApplicationBootstrap();

      const handler = vi.fn().mockResolvedValue(undefined);
      await provider.work('my-queue', { localConcurrency: 2 }, handler);

      expect(mockBoss.work).toHaveBeenCalledWith(
        'my-queue',
        { localConcurrency: 2 },
        expect.any(Function),
      );
    });

    it('maps pg-boss jobs to {id, data} before calling handler', async () => {
      const provider = new JobQueueService();
      await provider.onApplicationBootstrap();

      const handler = vi.fn().mockResolvedValue(undefined);
      await provider.work<{ val: string }>('q', { localConcurrency: 1 }, handler);

      // Get the wrapper function passed to mockBoss.work and invoke it
      const wrapFn = (mockBoss.work as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as (
        jobs: { id: string; data: { val: string } }[],
      ) => Promise<void>;
      await wrapFn([{ id: 'job-1', data: { val: 'hello' } }]);

      expect(handler).toHaveBeenCalledWith([{ id: 'job-1', data: { val: 'hello' } }]);
    });
  });

  describe('getQueueStats()', () => {
    it('returns stats from boss.getQueueStats', async () => {
      const provider = new JobQueueService();
      await provider.onApplicationBootstrap();

      const result = await provider.getQueueStats('my-queue');

      expect(mockBoss.getQueueStats).toHaveBeenCalledWith('my-queue');
      expect(result).toEqual({ queuedCount: 3 });
    });
  });

  describe('getOldestJobAgeSeconds()', () => {
    it('returns oldest job age from SQL query', async () => {
      const provider = new JobQueueService();
      await provider.onApplicationBootstrap();

      const result = await provider.getOldestJobAgeSeconds('my-queue');

      expect(result).toBe(42);
    });

    it('returns null when no jobs exist (oldest_seconds is null)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rows: [{ oldest_seconds: null }] });
      const provider = new JobQueueService();
      await provider.onApplicationBootstrap();

      const result = await provider.getOldestJobAgeSeconds('my-queue');

      expect(result).toBeNull();
    });
  });

  describe('onApplicationShutdown()', () => {
    it('stops pg-boss gracefully', async () => {
      const provider = new JobQueueService();
      await provider.onApplicationBootstrap();
      await provider.onApplicationShutdown();

      expect(mockBoss.stop).toHaveBeenCalledWith({ graceful: true });
    });

    it('is a no-op if called before bootstrap', async () => {
      const provider = new JobQueueService();
      await expect(provider.onApplicationShutdown()).resolves.toBeUndefined();
      expect(mockBoss.stop).not.toHaveBeenCalled();
    });
  });
});
