import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotTickRunner } from '@sources/core';
import { SnapshotWorkerService } from './snapshot-worker.service';

vi.mock('./snapshot-metrics', () => ({
  snapshotMetrics: {
    populationSize: { record: vi.fn() },
    proposalsProcessed: { add: vi.fn() },
    durationSeconds: { record: vi.fn() },
  },
}));

function makeRunner() {
  return { tickOnce: vi.fn() } as unknown as SnapshotTickRunner;
}

describe('SnapshotWorkerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tick() delegates to tickOnce()', async () => {
    const runner = makeRunner();
    vi.mocked(runner.tickOnce).mockResolvedValue({ outcome: 'idle' });
    const svc = new SnapshotWorkerService(runner);

    await expect(svc.tick()).resolves.toBeUndefined();
    expect(runner.tickOnce).toHaveBeenCalledTimes(1);
  });

  it('returns retry immediately when a tick is already in flight', async () => {
    const runner = makeRunner();
    vi.mocked(runner.tickOnce).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ outcome: 'idle' }), 100)),
    );
    const svc = new SnapshotWorkerService(runner);

    const p1 = svc.tickOnce();
    const p2 = svc.tickOnce();

    await expect(p2).resolves.toEqual({ outcome: 'retry' });
    await p1;
    expect(runner.tickOnce).toHaveBeenCalledTimes(1);
  });

  it('delegates tickOnce to the shared runner', async () => {
    const runner = makeRunner();
    vi.mocked(runner.tickOnce).mockResolvedValue({ outcome: 'verified', proposalId: 'proposal-1' });
    const svc = new SnapshotWorkerService(runner);

    await expect(svc.tickOnce()).resolves.toEqual({
      outcome: 'verified',
      proposalId: 'proposal-1',
    });
    expect(runner.tickOnce).toHaveBeenCalledTimes(1);
  });

  it('readIntervalMs uses env var when set to a positive number', () => {
    const original = process.env['SNAPSHOT_INTERVAL_MS'];
    process.env['SNAPSHOT_INTERVAL_MS'] = '5000';
    const svc = new SnapshotWorkerService(makeRunner());
    expect(svc).toBeInstanceOf(SnapshotWorkerService);
    process.env['SNAPSHOT_INTERVAL_MS'] = original;
  });
});
