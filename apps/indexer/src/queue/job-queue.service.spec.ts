import { PgBoss } from 'pg-boss';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeArchiveProducer } from '@sources/core';
import { JobQueueService } from './job-queue.service';
import { ARCHIVE_LOG_QUEUE, ARCHIVE_LOG_DLQ_QUEUE } from './queue-names';

const { mockBoss, mockProducer } = vi.hoisted(() => ({
  mockBoss: {
    on: vi.fn(),
    start: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    createQueue: vi.fn<[string, object?], Promise<void>>().mockResolvedValue(undefined),
    send: vi.fn<[], Promise<string>>().mockResolvedValue('job-id'),
    stop: vi.fn<[object?], Promise<void>>().mockResolvedValue(undefined),
  },
  mockProducer: vi.fn(),
}));

vi.mock('pg-boss', () => ({
  PgBoss: vi.fn().mockImplementation(function () {
    return mockBoss;
  }),
  fromKysely: vi.fn().mockReturnValue('kysely-db-adapter'),
}));

vi.mock('@libs/db', () => ({
  pgDb: {},
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
