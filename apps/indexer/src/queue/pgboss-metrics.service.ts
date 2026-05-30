import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'kysely';
import { chainMetrics } from '@libs/chain';
import { pgDb } from '@libs/db';
import { ArchiveProducerProvider } from './archive-producer.provider';
import { ARCHIVE_LOG_QUEUE } from './queue-names';

const DEFAULT_INTERVAL_MS = 15_000;

@Injectable()
export class PgBossMetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PgBossMetrics');
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly archiveProducer: ArchiveProducerProvider) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.archiveProducer.whenBossReady();
    const intervalMs = parseInt(
      process.env['PGBOSS_METRICS_INTERVAL_MS'] ?? String(DEFAULT_INTERVAL_MS),
      10,
    );
    void this.tick();
    this.interval = setInterval(() => void this.tick(), intervalMs);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick(): Promise<void> {
    try {
      const boss = this.archiveProducer.getBoss();

      // Queue depth: count of jobs in created/retry state.
      const stats = await boss.getQueueStats(ARCHIVE_LOG_QUEUE);
      chainMetrics.archiveLogQueueDepth.record(stats?.queuedCount ?? 0);

      // Queue age: age of the oldest pending job (raw SQL — pg-boss v12 has no built-in API).
      const row = await sql<{ oldest_seconds: number | null }>`
        SELECT EXTRACT(EPOCH FROM (now() - MIN(created_on)))::int AS oldest_seconds
        FROM pgboss.job
        WHERE name = ${ARCHIVE_LOG_QUEUE}
          AND state IN ('created', 'retry')
      `
        .execute(pgDb)
        .then((r) => r.rows[0]);

      chainMetrics.archiveLogQueueAgeSeconds.record(row?.oldest_seconds ?? 0);
    } catch (err) {
      this.logger.warn('pgboss_metrics_tick_failed', { error: String(err) });
    }
  }
}
