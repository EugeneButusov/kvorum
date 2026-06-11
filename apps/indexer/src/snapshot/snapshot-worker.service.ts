import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SnapshotTickRunner, type SnapshotTickOutcome } from '@sources/core';
import { snapshotMetrics } from './snapshot-metrics';
import { readIntervalMs } from '../app/env-helpers';

const SNAPSHOT_INTERVAL_MS = readIntervalMs('SNAPSHOT_INTERVAL_MS', 30_000);

@Injectable()
export class SnapshotWorkerService {
  private inFlight = false;

  constructor(private readonly runner: SnapshotTickRunner) {}

  @Interval(SNAPSHOT_INTERVAL_MS)
  /* v8 ignore next -- prod-only-DI: tick() is invoked by NestJS @Interval scheduler, not directly in unit tests */
  async tick(): Promise<void> {
    await this.tickOnce();
  }

  async tickOnce(): Promise<SnapshotTickOutcome> {
    if (this.inFlight) return { outcome: 'retry' };
    this.inFlight = true;
    const startedAt = Date.now();

    try {
      return await this.runner.tickOnce();
    } finally {
      snapshotMetrics.durationSeconds.record((Date.now() - startedAt) / 1000);
      this.inFlight = false;
    }
  }
}
