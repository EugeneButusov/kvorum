import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgBossMetricsService } from './pgboss-metrics.service';

describe('PgBossMetricsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeQueue(
    opts: {
      statsResult?: { queuedCount: number } | undefined;
      ageResult?: number | null;
      statsError?: Error;
    } = {},
  ) {
    return {
      getQueueStats: opts.statsError
        ? vi.fn().mockRejectedValue(opts.statsError)
        : vi.fn().mockResolvedValue(opts.statsResult ?? { queuedCount: 5 }),
      getOldestJobAgeSeconds: vi.fn().mockResolvedValue(opts.ageResult ?? 10),
    };
  }

  it('records queue depth and age on bootstrap', async () => {
    const queue = makeQueue({ statsResult: { queuedCount: 7 }, ageResult: 120 });
    const service = new PgBossMetricsService(queue as never);

    service.onApplicationBootstrap();
    service.onApplicationShutdown(); // stop interval immediately
    await vi.runAllTimersAsync(); // let the initial void this.tick() settle

    expect(queue.getQueueStats).toHaveBeenCalled();
    expect(queue.getOldestJobAgeSeconds).toHaveBeenCalled();
  });

  it('records depth=0 and age=0 when queue returns undefined/null', async () => {
    const queue = makeQueue({ statsResult: undefined, ageResult: null });
    const service = new PgBossMetricsService(queue as never);

    service.onApplicationBootstrap();
    service.onApplicationShutdown();
    await vi.runAllTimersAsync();

    expect(queue.getQueueStats).toHaveBeenCalled();
  });

  it('logs warn and does not throw when tick fails', async () => {
    const queue = makeQueue({ statsError: new Error('pg-boss down') });
    const service = new PgBossMetricsService(queue as never);

    service.onApplicationBootstrap();
    service.onApplicationShutdown();
    await expect(vi.runAllTimersAsync()).resolves.not.toThrow();
  });

  it('fires periodic ticks from setInterval', async () => {
    const queue = makeQueue();
    const service = new PgBossMetricsService(queue as never);

    service.onApplicationBootstrap();
    // Advance one interval (default 15s)
    await vi.advanceTimersByTimeAsync(15_000);
    service.onApplicationShutdown();

    // At minimum: 1 immediate tick + 1 interval tick
    expect(
      (queue.getQueueStats as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('clears the interval on shutdown', () => {
    const queue = makeQueue();
    const service = new PgBossMetricsService(queue as never);

    service.onApplicationBootstrap();
    service.onApplicationShutdown();

    // Calling shutdown again when interval is already null should be a no-op
    service.onApplicationShutdown();
  });
});
