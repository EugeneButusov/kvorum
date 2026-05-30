import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PgBoss, fromKysely } from 'pg-boss';
import type { EventsListener, LogEvent } from '@libs/chain';
import { pgDb, SeenLogRepository } from '@libs/db';
import { makeArchiveProducer, type RawLogJob } from '@sources/core';
import { ARCHIVE_LOG_QUEUE, ARCHIVE_LOG_DLQ_QUEUE } from './queue-names';

/** Default forensics window: 7 days. Overridable via ARCHIVE_LOG_JOB_TTL_SECONDS. */
const DEFAULT_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class ArchiveProducerProvider implements OnApplicationBootstrap, OnApplicationShutdown {
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

  /** Resolves once pg-boss has started and queues are created. */
  whenBossReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Returns the started PgBoss instance. Call after whenBossReady() resolves. */
  getBoss(): PgBoss {
    if (!this.boss) throw new Error('pg-boss not started');
    return this.boss;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true });
    this.boss = null;
  }
}
