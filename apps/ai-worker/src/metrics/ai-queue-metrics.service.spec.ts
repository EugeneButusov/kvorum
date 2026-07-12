import { describe, expect, it, vi } from 'vitest';
import { AiQueueMetricsService } from './ai-queue-metrics.service';
import { FEATURE_QUEUE } from '../queue/ai-queue-names';

type WithTick = { tick(): Promise<void> };

describe('AiQueueMetricsService', () => {
  it('polls stats + oldest age for every main and dlq queue', async () => {
    const getQueueStats = vi.fn().mockResolvedValue({ queuedCount: 3 });
    const getOldestJobAgeSeconds = vi.fn().mockResolvedValue(42);
    const port = { send: vi.fn(), work: vi.fn(), getQueueStats, getOldestJobAgeSeconds };
    const svc = new AiQueueMetricsService(port as never) as unknown as WithTick;

    await svc.tick();

    const queueCount = Object.values(FEATURE_QUEUE).length * 2; // main + dlq
    expect(getQueueStats).toHaveBeenCalledTimes(queueCount);
    expect(getOldestJobAgeSeconds).toHaveBeenCalledTimes(queueCount);
  });
});
