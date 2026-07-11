import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { pgDb } from '@libs/db';
import { FEATURE_QUEUE } from './ai-queue-names';
import type { AiJob } from './ai-queue-names';
import type { AiQueueJob, AiQueuePort, AiSendOptions } from './ai-queue.port';

/** Default forensics window for AI jobs: 7 days. Overridable via AI_JOB_TTL_SECONDS. */
const DEFAULT_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AiJobQueueService
  implements AiQueuePort, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('AiJobQueue');
  private boss: PgBoss | null = null;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.readyPromise = new Promise((res) => (this.resolveReady = res));
  }

  async onApplicationBootstrap(): Promise<void> {
    this.boss = new PgBoss({
      connectionString: process.env['DATABASE_URL'],
      schema: 'pgboss',
      migrate: false,
    });
    /* v8 ignore next -- boss 'error' event is fired by pg-boss internals; not deterministically testable */
    this.boss.on('error', (e: Error) => this.logger.error('pgboss_error', e));
    await this.boss.start();

    const ttl = parseInt(process.env['AI_JOB_TTL_SECONDS'] ?? String(DEFAULT_JOB_TTL_SECONDS), 10);

    for (const { main, dlq } of Object.values(FEATURE_QUEUE)) {
      // DLQ must exist before the main queue references it as deadLetter.
      await this.boss.createQueue(dlq);
      await this.boss.createQueue(main, {
        retryLimit: 3,
        retryBackoff: true,
        deadLetter: dlq,
        deleteAfterSeconds: ttl,
      });
    }

    this.resolveReady();
    this.logger.log('ai_job_queue_ready');
  }

  async send(queue: string, job: AiJob, opts: AiSendOptions = {}): Promise<string | null> {
    await this.readyPromise;
    return this.boss!.send(queue, job, {
      singletonKey: opts.singletonKey,
      singletonSeconds: opts.singletonSeconds,
    });
  }

  async work<T>(
    queue: string,
    opts: { localConcurrency: number },
    handler: (jobs: ReadonlyArray<AiQueueJob<T>>) => Promise<void>,
  ): Promise<void> {
    await this.readyPromise;
    await this.boss!.work<T>(queue, opts, (pgJobs) =>
      handler(pgJobs.map((j) => ({ id: j.id, data: j.data }))),
    );
  }

  async getQueueStats(queue: string): Promise<{ queuedCount: number } | undefined> {
    await this.readyPromise;
    return this.boss!.getQueueStats(queue);
  }

  async getOldestJobAgeSeconds(queue: string): Promise<number | null> {
    await this.readyPromise;
    const row = await sql<{ oldest_seconds: number | null }>`
      SELECT EXTRACT(EPOCH FROM (now() - MIN(created_on)))::int AS oldest_seconds
      FROM pgboss.job
      WHERE name = ${queue}
        AND state IN ('created', 'retry')
    `
      .execute(pgDb)
      .then((r) => r.rows[0]);
    return row?.oldest_seconds ?? null;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true });
    this.boss = null;
  }
}
