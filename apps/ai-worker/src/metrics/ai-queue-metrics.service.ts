import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { readPositiveInt } from '@libs/utils';
import { aiMetrics } from './ai-metrics';
import { FEATURE_QUEUE } from '../queue/ai-queue-names';
import { AI_QUEUE_PORT } from '../queue/ai-queue.port';
import type { AiQueuePort } from '../queue/ai-queue.port';

const DEFAULT_INTERVAL_MS = 15_000;

@Injectable()
export class AiQueueMetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AiQueueMetrics');
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(AI_QUEUE_PORT) private readonly queue: AiQueuePort) {}

  onApplicationBootstrap(): void {
    const intervalMs = readPositiveInt('AI_QUEUE_METRICS_MS', DEFAULT_INTERVAL_MS);
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
      const queues = Object.values(FEATURE_QUEUE).flatMap((q) => [q.main, q.dlq]);
      for (const queue of queues) {
        const stats = await this.queue.getQueueStats(queue);
        aiMetrics.jobQueueDepth.record(stats?.queuedCount ?? 0, { queue });
        const ageSeconds = await this.queue.getOldestJobAgeSeconds(queue);
        aiMetrics.jobQueueAgeSeconds.record(ageSeconds ?? 0, { queue });
      }
    } catch (err) {
      this.logger.warn('ai_queue_metrics_tick_failed', { error: String(err) });
    }
  }
}
