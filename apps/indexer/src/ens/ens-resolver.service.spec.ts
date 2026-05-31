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

  it('returns skipped_inflight when a tick is already in progress', async () => {
    vi.mocked(tickEnsResolution).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ outcome: 'idle' }), 100)),
    );

    const service = new EnsResolverService({} as never, {} as never);
    const p1 = service.tickOnce(); // starts first tick
    const p2 = service.tickOnce(); // second tick while first is running

    await expect(p2).resolves.toBe('skipped_inflight');
    await p1;
  });

  it('logs warn for mismatch and error outcomes in perCandidate', async () => {
    vi.mocked(tickEnsResolution).mockResolvedValueOnce({
      outcome: 'completed',
      counts: { resolved: 0, no_record: 0, mismatch: 1, error: 1 },
      perCandidate: [
        {
          actorId: 'a1',
          address: '0x1',
          outcome: { kind: 'mismatch', reverseName: 'bob.eth' },
        },
        {
          actorId: 'a2',
          address: '0x2',
          outcome: { kind: 'error', reason: 'rpc_failed' },
        },
      ],
    });

    const service = new EnsResolverService({} as never, {} as never);
    await expect(service.tickOnce()).resolves.toBe('completed');
  });

  it('tick() delegates to tickOnce()', async () => {
    vi.mocked(tickEnsResolution).mockResolvedValueOnce({ outcome: 'idle' });
    const service = new EnsResolverService({} as never, {} as never);
    await expect(service.tick()).resolves.toBeUndefined();
  });
});
