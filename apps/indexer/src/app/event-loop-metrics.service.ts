import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { defineGauge } from '@libs/observability';

const eventLoopLagSecondsMax = defineGauge({
  name: 'event_loop_lag_seconds_max',
  description: 'Maximum event loop lag observed over the sampling window (seconds)',
});

const eventLoopLagSecondsP99 = defineGauge({
  name: 'event_loop_lag_seconds_p99',
  description: 'P99 event loop lag observed over the sampling window (seconds)',
});

@Injectable()
export class EventLoopMetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly histogram = monitorEventLoopDelay({ resolution: 20 });
  private interval: ReturnType<typeof setInterval> | null = null;

  async onApplicationBootstrap(): Promise<void> {
    this.histogram.enable();
    this.interval = setInterval(() => {
      eventLoopLagSecondsMax.record(this.histogram.max / 1e9);
      eventLoopLagSecondsP99.record(this.histogram.percentile(99) / 1e9);
      this.histogram.reset();
    }, 5000);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.histogram.disable();
  }
}
