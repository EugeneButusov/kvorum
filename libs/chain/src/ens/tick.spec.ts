import { describe, expect, it, vi } from 'vitest';
import { tickEnsResolution } from './tick.js';

describe('tickEnsResolution', () => {
  it('returns idle when no candidates', async () => {
    const actorRepo = {
      findEnsRefreshCandidates: vi.fn().mockResolvedValue([]),
      updateDisplayName: vi.fn(),
    };
    const ensClient = {
      batchReverseResolve: vi.fn(),
    };

    await expect(
      tickEnsResolution({
        ensClient: ensClient as never,
        actorRepo,
        opts: { limit: 10, ttlSeconds: 3600 },
      }),
    ).resolves.toEqual({ outcome: 'idle' });

    expect(ensClient.batchReverseResolve).not.toHaveBeenCalled();
    expect(actorRepo.updateDisplayName).not.toHaveBeenCalled();
  });

  it('counts mismatch and error outcomes without calling updateDisplayName', async () => {
    const candidates = [
      { id: 'a1', primary_address: '0x1' },
      { id: 'a2', primary_address: '0x2' },
    ];
    const outcomes = new Map([
      ['0x1', { kind: 'mismatch', reverseName: 'bob.eth' }],
      ['0x2', { kind: 'error', reason: 'rpc_failed' }],
    ]);
    const actorRepo = {
      findEnsRefreshCandidates: vi.fn().mockResolvedValue(candidates),
      updateDisplayName: vi.fn(),
    };
    const ensClient = { batchReverseResolve: vi.fn().mockResolvedValue(outcomes) };

    const result = await tickEnsResolution({
      ensClient: ensClient as never,
      actorRepo,
      opts: { limit: 10, ttlSeconds: 3600 },
    });

    expect(result).toMatchObject({ outcome: 'completed', counts: { mismatch: 1, error: 1 } });
    expect(actorRepo.updateDisplayName).not.toHaveBeenCalled();
  });

  it('uses missing_outcome_from_client when address is absent from results map', async () => {
    const candidates = [{ id: 'a1', primary_address: '0x1' }];
    const actorRepo = {
      findEnsRefreshCandidates: vi.fn().mockResolvedValue(candidates),
      updateDisplayName: vi.fn(),
    };
    const ensClient = { batchReverseResolve: vi.fn().mockResolvedValue(new Map()) };

    const result = await tickEnsResolution({
      ensClient: ensClient as never,
      actorRepo,
      opts: { limit: 10, ttlSeconds: 3600 },
    });

    expect(result).toMatchObject({ outcome: 'completed', counts: { error: 1 } });
    expect(
      (result as { perCandidate: { outcome: { reason: string } }[] }).perCandidate[0]?.outcome,
    ).toMatchObject({
      kind: 'error',
      reason: 'missing_outcome_from_client',
    });
  });

  it('applies resolved and no_record outcomes', async () => {
    const candidates = [
      { id: 'a1', primary_address: '0x1' },
      { id: 'a2', primary_address: '0x2' },
    ];
    const outcomes = new Map([
      ['0x1', { kind: 'resolved', name: 'alice.eth' }],
      ['0x2', { kind: 'no_record' }],
    ]);

    const actorRepo = {
      findEnsRefreshCandidates: vi.fn().mockResolvedValue(candidates),
      updateDisplayName: vi.fn().mockResolvedValue(undefined),
    };
    const ensClient = {
      batchReverseResolve: vi.fn().mockResolvedValue(outcomes),
    };

    const result = await tickEnsResolution({
      ensClient: ensClient as never,
      actorRepo,
      opts: { limit: 10, ttlSeconds: 3600 },
    });

    expect(result).toEqual({
      outcome: 'completed',
      counts: { resolved: 1, no_record: 1, mismatch: 0, error: 0 },
      perCandidate: [
        { actorId: 'a1', address: '0x1', outcome: { kind: 'resolved', name: 'alice.eth' } },
        { actorId: 'a2', address: '0x2', outcome: { kind: 'no_record' } },
      ],
    });
    expect(actorRepo.updateDisplayName).toHaveBeenNthCalledWith(1, {
      actorId: 'a1',
      displayName: 'alice.eth',
    });
    expect(actorRepo.updateDisplayName).toHaveBeenNthCalledWith(2, {
      actorId: 'a2',
      displayName: null,
    });
  });
});
