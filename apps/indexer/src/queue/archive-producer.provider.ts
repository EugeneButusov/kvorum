import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { fromKysely } from 'pg-boss';
import type { EventsListener, LogEvent } from '@libs/chain';
import { pgDb, SeenLogRepository } from '@libs/db';
import { makeArchiveProducer, type RawLogJob } from '@sources/core';
import { PgBossLifecycle, ARCHIVE_CH_QUEUE } from './pg-boss-lifecycle';

export const ARCHIVE_PRODUCER = 'ARCHIVE_PRODUCER';

@Injectable()
export class ArchiveProducerProvider implements OnApplicationBootstrap {
  private readonly logger = new Logger('ArchiveProducer');
  private readonly seenLog = new SeenLogRepository(pgDb);
  private producer: EventsListener<LogEvent> | null = null;
  private ready!: Promise<void>;
  private resolveReady!: () => void;

  constructor(private readonly lifecycle: PgBossLifecycle) {
    this.ready = new Promise((res) => (this.resolveReady = res));
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.lifecycle.whenReady();
    const boss = this.lifecycle.instance;

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
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  get listener(): EventsListener<LogEvent> {
    if (!this.producer) throw new Error('ArchiveProducer not ready');
    return this.producer;
  }
}
