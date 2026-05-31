import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'kysely';
import { PgBoss, fromKysely } from 'pg-boss';
import type { EventsListener, LogEvent } from '@libs/chain';
import { pgDb, SeenLogRepository } from '@libs/db';
import { makeArchiveProducer, type RawLogJob } from '@sources/core';
import type { JobQueuePort, QueueJob } from './job-queue-port';
import { ARCHIVE_LOG_QUEUE, ARCHIVE_LOG_DLQ_QUEUE } from './queue-names';

/** Default forensics window: 7 days. Overridable via ARCHIVE_LOG_JOB_TTL_SECONDS. */
const DEFAULT_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class ArchiveProducerProvider
  implements JobQueuePort, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('ArchiveProducer');
  private boss: PgBoss | null = null;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  readonly listener: EventsListener<LogEvent>;

  constructor() {
    this.readyPromise = new Promise((res) => (this.resolveReady = res));
    this.listener = makeArchiveProducer({
      pgDb,
      seenLog: new SeenLogRepository(pgDb),
      enqueue: async (job: RawLogJob, trx) => {
        await this.boss!.send(ARCHIVE_LOG_QUEUE, job, { db: fromKysely(trx) });
      },
      logger: {
        debug: (msg, ctx) => this.logger.debug(msg, ctx),
        error: (msg, ctx) => this.logger.error(msg, ctx),
      },
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    this.boss = new PgBoss({
      connectionString: process.env['DATABASE_URL'],
      schema: 'pgboss',
      migrate: false,
    });
    this.boss.on('error', (e: Error) => this.logger.error('pgboss_error', e));
    await this.boss.start();

    const jobTtlSeconds = parseInt(
      process.env['ARCHIVE_LOG_JOB_TTL_SECONDS'] ?? String(DEFAULT_JOB_TTL_SECONDS),
      10,
    );

    // DLQ must exist before the main queue references it as deadLetter.
    await this.boss.createQueue(ARCHIVE_LOG_DLQ_QUEUE);
    await this.boss.createQueue(ARCHIVE_LOG_QUEUE, {
      retryLimit: 5,
      retryBackoff: true,
      deadLetter: ARCHIVE_LOG_DLQ_QUEUE,
      deleteAfterSeconds: jobTtlSeconds,
    });

    this.resolveReady();
    this.logger.log('archive_producer_ready');
  }

  async work<T>(
    queue: string,
    opts: { localConcurrency: number },
    handler: (jobs: ReadonlyArray<QueueJob<T>>) => Promise<void>,
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
