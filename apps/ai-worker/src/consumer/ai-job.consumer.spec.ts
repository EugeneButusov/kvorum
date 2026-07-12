import { describe, expect, it, vi } from 'vitest';
import { AiFeatureHandlerRegistry } from './ai-feature-handler.registry';
import { AiJobConsumer } from './ai-job.consumer';
import { FEATURE_QUEUE } from '../queue/ai-queue-names';
import type { AiJob } from '../queue/ai-queue-names';

// handle() is private; test it via a thin cast (the behavior under test is the dispatch policy).
type WithHandle = { handle(job: AiJob): Promise<void> };

const noopPort = {
  send: vi.fn(),
  work: vi.fn(),
  getQueueStats: vi.fn(),
  getOldestJobAgeSeconds: vi.fn(),
};

describe('AiJobConsumer.handle', () => {
  const job: AiJob = { feature: 'proposal_summarizer', entityRef: 'proposal:p1' };

  it('dispatches to a registered handler', async () => {
    const registry = new AiFeatureHandlerRegistry();
    const handler = { handle: vi.fn().mockResolvedValue(undefined) };
    registry.register('proposal_summarizer', handler);
    const consumer = new AiJobConsumer(noopPort, registry) as unknown as WithHandle;
    await consumer.handle(job);
    expect(handler.handle).toHaveBeenCalledWith(job);
  });

  it('gracefully skips (no throw) when no handler is registered', async () => {
    const registry = new AiFeatureHandlerRegistry();
    const consumer = new AiJobConsumer(noopPort, registry) as unknown as WithHandle;
    await expect(consumer.handle(job)).resolves.toBeUndefined();
  });

  it('propagates a throwing handler so pg-boss retries → DLQ', async () => {
    const registry = new AiFeatureHandlerRegistry();
    registry.register('proposal_summarizer', {
      handle: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const consumer = new AiJobConsumer(noopPort, registry) as unknown as WithHandle;
    await expect(consumer.handle(job)).rejects.toThrow('boom');
  });
});

describe('AiJobConsumer.onApplicationBootstrap', () => {
  it('registers work() once per feature queue with the correct queue name and concurrency', async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    const port = {
      send: vi.fn(),
      work,
      getQueueStats: vi.fn(),
      getOldestJobAgeSeconds: vi.fn(),
    };
    const registry = new AiFeatureHandlerRegistry();
    const consumer = new AiJobConsumer(port, registry);

    process.env['AI_JOB_CONCURRENCY'] = '3';
    try {
      await consumer.onApplicationBootstrap();
    } finally {
      delete process.env['AI_JOB_CONCURRENCY'];
    }

    const mainQueues = Object.values(FEATURE_QUEUE).map((q) => q.main);
    expect(work).toHaveBeenCalledTimes(mainQueues.length);
    for (const queueName of mainQueues) {
      expect(work).toHaveBeenCalledWith(queueName, { localConcurrency: 3 }, expect.any(Function));
    }
  });
});
