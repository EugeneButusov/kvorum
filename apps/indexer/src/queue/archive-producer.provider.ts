import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PgBoss, fromKysely } from 'pg-boss';
import type { EventsListener, LogEvent } from '@libs/chain';
import { pgDb, SeenLogRepository } from '@libs/db';
import { makeArchiveProducer, type RawLogJob } from '@sources/core';
import { ARCHIVE_CH_QUEUE, ARCHIVE_CH_DLQ_QUEUE } from './queue-names';

@Injectable()
export class ArchiveProducerProvider implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ArchiveProducer');
  private readonly seenLog = new SeenLogRepository(pgDb);
  private boss: PgBoss | null = null;
  private producer: EventsListener<LogEvent> | null = null;
  private ready!: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.ready = new Promise((res) => (this.resolveReady = res));
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
    await this.boss.createQueue(ARCHIVE_CH_DLQ_QUEUE);
    await this.boss.createQueue(ARCHIVE_CH_QUEUE, {
      retryLimit: 5,
      retryBackoff: true,
      deadLetter: ARCHIVE_CH_DLQ_QUEUE,
    });

    const boss = this.boss;
    this.producer = makeArchiveProducer({
      pgDb,
      seenLog: this.seenLog,
      enqueue: async (job: RawLogJob, trx) => {
        await boss.send(ARCHIVE_CH_QUEUE, job, { db: fromKysely(trx) });
      },
      logger: {
        debug: (msg, ctx) => this.logger.debug(msg, ctx),
        error: (msg, ctx) => this.logger.error(msg, ctx),
      },
    });

    this.resolveReady();
    this.logger.log('archive_producer_ready');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true });
    this.boss = null;
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  get listener(): EventsListener<LogEvent> {
    if (!this.producer) throw new Error('ArchiveProducer not ready');
    return this.producer;
  }
}
