import { PgBoss } from 'pg-boss';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeArchiveProducer } from '@sources/core';
import { ArchiveProducerProvider } from './archive-producer.provider';
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

describe('ArchiveProducerProvider', () => {
  describe('onApplicationBootstrap()', () => {
    it('constructs PgBoss with migrate:false and starts it', async () => {
      const provider = new ArchiveProducerProvider();
      await provider.onApplicationBootstrap();

      expect(PgBoss).toHaveBeenCalledWith(
        expect.objectContaining({ migrate: false, schema: 'pgboss' }),
      );
      expect(mockBoss.start).toHaveBeenCalledOnce();
    });

    it('creates DLQ queue before main queue (deadLetter requires it to exist first)', async () => {
      const provider = new ArchiveProducerProvider();
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

    it('resolves whenReady() after bootstrap completes', async () => {
      const provider = new ArchiveProducerProvider();

      const readyBefore = vi.fn();
      provider.whenReady().then(readyBefore);
      await Promise.resolve(); // flush microtasks
      expect(readyBefore).not.toHaveBeenCalled(); // not yet resolved

      await provider.onApplicationBootstrap();
      await provider.whenReady(); // should resolve now
      expect(readyBefore).toHaveBeenCalledOnce();
    });

    it('builds the producer via makeArchiveProducer with an enqueue that calls boss.send', async () => {
      const provider = new ArchiveProducerProvider();
      await provider.onApplicationBootstrap();

      expect(makeArchiveProducer).toHaveBeenCalledOnce();
      const deps = vi.mocked(makeArchiveProducer).mock.calls[0]![0];

      // Exercise the enqueue closure to verify it sends to the correct queue
      const fakeJob = { chainId: '0x1' } as never;
      const fakeTrx = {} as never;
      await deps.enqueue(fakeJob, fakeTrx);
      expect(mockBoss.send).toHaveBeenCalledWith(ARCHIVE_LOG_QUEUE, fakeJob, expect.any(Object));
    });
  });

  describe('listener getter', () => {
    it('throws before bootstrap', () => {
      const provider = new ArchiveProducerProvider();
      expect(() => provider.listener).toThrow('ArchiveProducer not ready');
    });

    it('returns the producer after bootstrap', async () => {
      const provider = new ArchiveProducerProvider();
      await provider.onApplicationBootstrap();
      expect(provider.listener).toBe(mockProducer);
    });
  });

  describe('onApplicationShutdown()', () => {
    it('stops pg-boss gracefully and nulls the instance', async () => {
      const provider = new ArchiveProducerProvider();
      await provider.onApplicationBootstrap();
      await provider.onApplicationShutdown();

      expect(mockBoss.stop).toHaveBeenCalledWith({ graceful: true });
    });

    it('is a no-op if called before bootstrap', async () => {
      const provider = new ArchiveProducerProvider();
      await expect(provider.onApplicationShutdown()).resolves.toBeUndefined();
      expect(mockBoss.stop).not.toHaveBeenCalled();
    });
  });
});
