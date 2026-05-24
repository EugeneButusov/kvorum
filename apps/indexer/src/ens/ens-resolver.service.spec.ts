import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tickEnsResolution } from '@libs/chain';
import { EnsResolverService } from './ens-resolver.service';

vi.mock('@libs/chain', () => ({
  tickEnsResolution: vi.fn(),
}));

vi.mock('./ens-resolver-metrics', () => ({
  ensResolverMetrics: {
    resolutions: { add: vi.fn() },
    durationSeconds: { record: vi.fn() },
  },
}));

describe('EnsResolverService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns idle when helper returns idle', async () => {
    vi.mocked(tickEnsResolution).mockResolvedValueOnce({ outcome: 'idle' });

    const service = new EnsResolverService({} as never, {} as never);
    await expect(service.tickOnce()).resolves.toBe('idle');
  });

  it('emits metrics for completed result', async () => {
    vi.mocked(tickEnsResolution).mockResolvedValueOnce({
      outcome: 'completed',
      counts: { resolved: 1, no_record: 2, mismatch: 3, error: 4 },
      perCandidate: [],
    });

    const service = new EnsResolverService({} as never, {} as never);
    await expect(service.tickOnce()).resolves.toBe('completed');
  });
});
