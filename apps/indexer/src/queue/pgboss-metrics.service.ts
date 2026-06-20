import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { chainMetrics } from '@libs/chain';
import { ARCHIVE_LOG_QUEUE, OFF_CHAIN_ARCHIVE_QUEUE } from './queue-names';
import { QUEUE_WORKER_PORT } from './queue-worker-port';
import type { QueueWorkerPort } from './queue-worker-port';

const DEFAULT_INTERVAL_MS = 15_000;

@Injectable()
export class PgBossMetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PgBossMetrics');
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(QUEUE_WORKER_PORT) private readonly queue: QueueWorkerPort) {}

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
      for (const queue of [ARCHIVE_LOG_QUEUE, OFF_CHAIN_ARCHIVE_QUEUE]) {
        const stats = await this.queue.getQueueStats(queue);
        chainMetrics.archiveLogQueueDepth.record(stats?.queuedCount ?? 0, { queue });

        const ageSeconds = await this.queue.getOldestJobAgeSeconds(queue);
        chainMetrics.archiveLogQueueAgeSeconds.record(ageSeconds ?? 0, { queue });
      }
    } catch (err) {
      this.logger.warn('pgboss_metrics_tick_failed', { error: String(err) });
    }
  }
}
