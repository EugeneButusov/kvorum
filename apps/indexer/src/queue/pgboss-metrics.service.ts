import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { chainMetrics } from '@libs/chain';
import { JOB_QUEUE_PORT } from './job-queue-port';
import type { JobQueuePort } from './job-queue-port';
import { ARCHIVE_LOG_QUEUE } from './queue-names';

const DEFAULT_INTERVAL_MS = 15_000;

@Injectable()
export class PgBossMetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PgBossMetrics');
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(JOB_QUEUE_PORT) private readonly queue: JobQueuePort) {}

  onApplicationBootstrap(): void {
    const intervalMs = parseInt(
      process.env['PGBOSS_METRICS_INTERVAL_MS'] ?? String(DEFAULT_INTERVAL_MS),
      10,
    );
    void this.tick();
    this.interval = setInterval(() => void this.tick(), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick(): Promise<void> {
    try {
      const stats = await this.queue.getQueueStats(ARCHIVE_LOG_QUEUE);
      chainMetrics.archiveLogQueueDepth.record(stats?.queuedCount ?? 0);

      const ageSeconds = await this.queue.getOldestJobAgeSeconds(ARCHIVE_LOG_QUEUE);
      chainMetrics.archiveLogQueueAgeSeconds.record(ageSeconds ?? 0);
    } catch (err) {
      this.logger.warn('pgboss_metrics_tick_failed', { error: String(err) });
    }
  }
}
