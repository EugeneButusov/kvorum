import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PgBoss, fromKysely } from 'pg-boss';
import type { EventsListener, LogEvent } from '@libs/chain';
import { pgDb, SeenLogRepository } from '@libs/db';
import { makeArchiveProducer, type RawLogJob } from '@sources/core';
import { ARCHIVE_LOG_QUEUE, ARCHIVE_LOG_DLQ_QUEUE } from './queue-names';

@Injectable()
export class ArchiveProducerProvider implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ArchiveProducer');
  private boss: PgBoss | null = null;
  readonly listener: EventsListener<LogEvent>;

  constructor() {
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

    // DLQ must exist before the main queue references it as deadLetter.
    await this.boss.createQueue(ARCHIVE_LOG_DLQ_QUEUE);
    await this.boss.createQueue(ARCHIVE_LOG_QUEUE, {
      retryLimit: 5,
      retryBackoff: true,
      deadLetter: ARCHIVE_LOG_DLQ_QUEUE,
    });

    this.logger.log('archive_producer_ready');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true });
    this.boss = null;
  }
}
