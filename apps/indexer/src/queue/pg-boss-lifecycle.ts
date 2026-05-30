import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PgBoss } from 'pg-boss';

export const ARCHIVE_CH_QUEUE = 'archive_ch';
export const ARCHIVE_CH_DLQ_QUEUE = 'archive_ch_dlq';

@Injectable()
export class PgBossLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PgBoss');
  private boss: PgBoss | null = null;
  private ready!: Promise<void>;
  private resolveReady!: () => void;

  onModuleInit() {
    this.ready = new Promise((res) => (this.resolveReady = res));
  }

  async onApplicationBootstrap(): Promise<void> {
    // migrate:false is a CONSTRUCTOR option — passing it anywhere else is ignored.
    // start() with migrate:false only verifies the schema matches 0009_pgboss_schema; throws if stale.
    this.boss = new PgBoss({
      connectionString: process.env['DATABASE_URL'],
      schema: 'pgboss',
      migrate: false,
    });
    this.boss.on('error', (e: Error) => this.logger.error('pgboss_error', e));
    await this.boss.start();

    // Queues must exist before send()/work() on pg-boss v12.
    // DLQ must be created first — pg-boss validates that the deadLetter queue exists when
    // creating the main queue. Reversing the order produces "Queue archive_ch_dlq does not exist".
    await this.boss.createQueue(ARCHIVE_CH_DLQ_QUEUE);
    await this.boss.createQueue(ARCHIVE_CH_QUEUE, {
      retryLimit: 5,
      retryBackoff: true,
      deadLetter: ARCHIVE_CH_DLQ_QUEUE,
    });

    this.resolveReady();
    this.logger.log('pg_boss_started');
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  get instance(): PgBoss {
    if (!this.boss) throw new Error('PgBoss not started');
    return this.boss;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true });
    this.boss = null;
    this.logger.log('pg_boss_stopped');
  }
}
