import { afterAll, describe, expect, it, vi } from 'vitest';
import { AiJobDlqRepository } from '@libs/ai';
import { pgDb } from '@libs/db';
import { AiJobDlqBridge } from './ai-job-dlq.bridge';
import { AiJobQueueService } from '../queue/ai-job-queue.service';
import { AI_SUMMARIZE_DLQ_QUEUE, FEATURE_QUEUE } from '../queue/ai-queue-names';
import type { AiJob } from '../queue/ai-queue-names';
import type { AiQueueJob } from '../queue/ai-queue.port';

type WithRecord = { record(job: AiQueueJob<AiJob>): Promise<void> };

describe('AiJobDlqBridge.record', () => {
  it('maps a dead-lettered job into an ai_job_dlq upsert row', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const port = {
      send: vi.fn(),
      work: vi.fn(),
      getQueueStats: vi.fn(),
      getOldestJobAgeSeconds: vi.fn(),
    };
    const bridge = new AiJobDlqBridge(port, { insert } as never) as unknown as WithRecord;

    const deadLettered: AiQueueJob<AiJob> = {
      id: 'job-123',
      data: { feature: 'proposal_summarizer', entityRef: 'proposal:p1', inputHash: 'sha256:x' },
    };
    await bridge.record(deadLettered);

    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row.feature).toBe('proposal_summarizer');
    expect(row.entity_ref).toBe('proposal:p1');
    expect(row.input_hash).toBe('sha256:x');
    expect(row.payload).toEqual(deadLettered.data);
    expect(row.error.message).toContain('job-123');
    expect(row.first_seen_at).toBeInstanceOf(Date);
    expect(row.last_seen_at).toBeInstanceOf(Date);
  });
});

describe('AiJobDlqBridge.onApplicationBootstrap', () => {
  it('registers work() on all four *_dlq queues', async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    const port = {
      send: vi.fn(),
      work,
      getQueueStats: vi.fn(),
      getOldestJobAgeSeconds: vi.fn(),
    };
    const bridge = new AiJobDlqBridge(port, { insert: vi.fn() } as never);

    await bridge.onApplicationBootstrap();

    const dlqQueues = Object.values(FEATURE_QUEUE).map((q) => q.dlq);
    expect(work).toHaveBeenCalledTimes(dlqQueues.length);
    for (const queueName of dlqQueues) {
      expect(work).toHaveBeenCalledWith(queueName, { localConcurrency: 1 }, expect.any(Function));
    }
  });
});

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

describeWithDb('AiJobDlqBridge (integration)', () => {
  const svc = new AiJobQueueService();
  afterAll(async () => {
    await pgDb.deleteFrom('ai_job_dlq').where('entity_ref', '=', 'proposal:dlq-e2e').execute();
    await svc.onApplicationShutdown();
    await pgDb.destroy();
  });

  it('records a job sent onto a *_dlq queue into ai_job_dlq', async () => {
    await svc.onApplicationBootstrap();
    const bridge = new AiJobDlqBridge(svc, new AiJobDlqRepository(pgDb));
    await bridge.onApplicationBootstrap();

    await svc.send(AI_SUMMARIZE_DLQ_QUEUE, {
      feature: 'proposal_summarizer',
      entityRef: 'proposal:dlq-e2e',
    });

    // pg-boss 12.18.2 default poll interval is ~2000ms; the worker does one immediate fetch
    // then sleeps a full interval, so a 1500ms wait can miss delivery. Bumped to 3000ms
    // (test-only timing change, per Task 3 learnings; production code unaffected).
    await new Promise((r) => setTimeout(r, 3000));
    const rows = await pgDb
      .selectFrom('ai_job_dlq')
      .selectAll()
      .where('entity_ref', '=', 'proposal:dlq-e2e')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.feature).toBe('proposal_summarizer');
  });
});
