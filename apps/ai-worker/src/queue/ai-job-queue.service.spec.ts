import { afterAll, describe, expect, it } from 'vitest';
import { AiJobQueueService } from './ai-job-queue.service';
import { AI_SUMMARIZE_QUEUE } from './ai-queue-names';
import type { AiJob } from './ai-queue-names';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

describeWithDb('AiJobQueueService', () => {
  const svc = new AiJobQueueService();

  afterAll(async () => {
    await svc.onApplicationShutdown();
  });

  it('creates queues, sends+works a job, and throttles duplicates within a singleton window', async () => {
    await svc.onApplicationBootstrap();

    const key = `test:${Date.now()}`;
    const job: AiJob = { feature: 'proposal_summarizer', entityRef: key };

    const received: AiJob[] = [];
    await svc.work<AiJob>(AI_SUMMARIZE_QUEUE, { localConcurrency: 1 }, async (jobs) => {
      for (const j of jobs) received.push(j.data);
    });

    const first = await svc.send(AI_SUMMARIZE_QUEUE, job, {
      singletonKey: key,
      singletonSeconds: 120,
    });
    const second = await svc.send(AI_SUMMARIZE_QUEUE, job, {
      singletonKey: key,
      singletonSeconds: 120,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // same key+window → throttled

    // pg-boss@12's default work() poll interval is 2000ms (first fetch is immediate but
    // precedes the send() above, so the job is only visible on the *second* fetch tick);
    // 3000ms gives one full interval of margin over the brief's 1500ms to avoid flakiness.
    await new Promise((r) => setTimeout(r, 3000)); // let the worker poll
    expect(received.filter((r) => r.entityRef === key)).toHaveLength(1);
  });
});
