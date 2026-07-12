import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { AiJobDlqRepository } from '@libs/ai';
import { FEATURE_QUEUE } from '../queue/ai-queue-names';
import type { AiJob } from '../queue/ai-queue-names';
import { AI_QUEUE_PORT } from '../queue/ai-queue.port';
import type { AiQueueJob, AiQueuePort } from '../queue/ai-queue.port';

/** Drains dead-lettered AI jobs into ai_job_dlq so the dashboard and admin-cli surface them. */
@Injectable()
export class AiJobDlqBridge implements OnApplicationBootstrap {
  private readonly logger = new Logger('AiJobDlqBridge');

  constructor(
    @Inject(AI_QUEUE_PORT) private readonly queue: AiQueuePort,
    private readonly dlqRepo: AiJobDlqRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const { dlq } of Object.values(FEATURE_QUEUE)) {
      await this.queue.work<AiJob>(dlq, { localConcurrency: 1 }, async (jobs) => {
        for (const job of jobs) {
          await this.record(job);
        }
      });
    }
    this.logger.log('ai_job_dlq_bridge_registered');
  }

  // KNOWN-030: no try/catch around the ai_job_dlq insert below — a transient PG failure here
  // retries the job on the *_dlq queue (pg-boss redelivers on a throwing handler) and, once
  // retries are exhausted, the dead-lettered record is silently lost. `attempts` is hardcoded to
  // 0 because pg-boss does not surface the exhausted retry count via `includeMetadata` on the
  // dead-letter copy. Mirrors indexer's ArchiveLogDlqBridge; deferred by design.
  private async record(job: AiQueueJob<AiJob>): Promise<void> {
    const now = new Date();
    const data = job.data;
    await this.dlqRepo.insert({
      feature: data.feature,
      entity_ref: data.entityRef,
      input_hash: data.inputHash ?? null,
      payload: data,
      // pg-boss does not surface the exhausted retry count on the dead-letter copy; record 0
      // (mirrors ingestion's DLQ bridge). The upsert bumps last_seen_at on repeats.
      error: { name: 'DeadLettered', message: `job ${job.id} exhausted retries` },
      attempts: 0,
      first_seen_at: now,
      last_seen_at: now,
    });
    this.logger.warn('ai_job_dead_lettered', {
      jobId: job.id,
      feature: data.feature,
      entityRef: data.entityRef,
    });
  }
}
