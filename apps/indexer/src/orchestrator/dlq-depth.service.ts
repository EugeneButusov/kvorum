import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { chainMetrics } from '@libs/chain';
import { DlqRepository } from '@libs/db';

type SeriesKey = `${string}::${string}`; // stage::source

@Injectable()
export class DlqDepthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DlqDepth');
  private interval: ReturnType<typeof setInterval> | null = null;
  // Every (stage, source) pair this process has ever observed. When a series drains to
  // zero (e.g. via dlq accept) the GROUP BY query returns no row for it — without this
  // map, the gauge would freeze at its last non-zero value. We emit record(0) for any
  // previously-seen pair absent from the current tick.
  private readonly seenSeries = new Map<SeriesKey, { stage: string; source: string }>();

  constructor(private readonly dlqRepo: DlqRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    // Read at bootstrap rather than module scope so tests can override via process.env
    // before NestFactory.createApplicationContext() boots the app.
    const intervalMs = parseInt(process.env['DLQ_DEPTH_INTERVAL_MS'] ?? '10000', 10);
    void this.tick(); // immediate first sample
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
      const rows = await this.dlqRepo.depthByStageAndSource();
      const observedThisTick = new Set<SeriesKey>();

      for (const row of rows) {
        const key: SeriesKey = `${row.stage}::${row.source}`;
        observedThisTick.add(key);
        this.seenSeries.set(key, { stage: row.stage, source: row.source });
        chainMetrics.dlqDepth.record(row.count, { stage: row.stage, source: row.source });
      }

      for (const [key, labels] of this.seenSeries) {
        if (!observedThisTick.has(key)) {
          chainMetrics.dlqDepth.record(0, labels);
        }
      }
    } catch (err) {
      this.logger.warn('dlq_depth_tick_failed', { error: String(err) });
    }
  }
}
