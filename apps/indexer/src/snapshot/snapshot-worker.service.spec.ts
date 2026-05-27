import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VotingPowerStrategy } from '@libs/domain';
import { SnapshotWorkerService } from './snapshot-worker.service';

vi.mock('./snapshot-metrics', () => ({
  snapshotMetrics: {
    populationSize: { record: vi.fn() },
    proposalsProcessed: { add: vi.fn() },
    rpcCalls: { add: vi.fn() },
    sampleMismatch: { add: vi.fn() },
    durationSeconds: { record: vi.fn() },
  },
}));

function makeRepos() {
  return {
    proposalRepo: {
      findNextSnapshotCandidate: vi.fn(),
    },
    snapshotRepo: { bulkInsert: vi.fn() },
    actorRepo: { findPrimaryAddressesByActorIds: vi.fn() },
    runRepo: {
      findByProposalId: vi.fn(),
      touchAttempt: vi.fn(),
      insertInProgress: vi.fn(),
      markCompleted: vi.fn(),
      incrementAttempt: vi.fn(),
      markFailed: vi.fn(),
    },
    dlqRepo: {
      insert: vi.fn(),
    },
  };
}

function makeCandidate() {
  return {
    id: 'proposal-1',
    dao_id: 'dao-1',
    source_type: 'compound_governor_bravo',
    voting_power_block: '123',
  };
}

describe('SnapshotWorkerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns idle when there is no candidate', async () => {
    const repos = makeRepos();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(undefined);
    const svc = new SnapshotWorkerService(
      repos.proposalRepo as never,
      repos.snapshotRepo as never,
      repos.actorRepo as never,
      repos.runRepo as never,
      repos.dlqRepo as never,
      new Map<string, VotingPowerStrategy>([
        ['compound_governor_bravo', { computeSnapshot: vi.fn(), verifyOnChain: vi.fn() } as never],
      ]),
    );

    await expect(svc.tickOnce()).resolves.toEqual({ outcome: 'idle' });
    expect(repos.proposalRepo.findNextSnapshotCandidate).toHaveBeenCalledWith(
      ['compound_governor_bravo'],
      ['active', 'succeeded', 'defeated', 'queued', 'executed', 'expired', 'vetoed'],
      5,
    );
  });

  it('marks run as failed when no strategy is registered for candidate source', async () => {
    const repos = makeRepos();
    const candidate = makeCandidate();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue(undefined);
    const svc = new SnapshotWorkerService(
      repos.proposalRepo as never,
      repos.snapshotRepo as never,
      repos.actorRepo as never,
      repos.runRepo as never,
      repos.dlqRepo as never,
      new Map<string, VotingPowerStrategy>(),
    );

    await expect(svc.tickOnce()).resolves.toEqual({
      outcome: 'no_strategy',
      proposalId: candidate.id,
    });
    expect(repos.runRepo.insertInProgress).toHaveBeenCalledTimes(1);
    expect(repos.runRepo.markFailed).toHaveBeenCalledWith(
      candidate.id,
      expect.objectContaining({ last_error: 'no_strategy_registered' }),
    );
  });

  it('writes computed snapshot rows and marks run completed', async () => {
    const repos = makeRepos();
    const candidate = makeCandidate();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue(undefined);
    repos.actorRepo.findPrimaryAddressesByActorIds.mockResolvedValue([
      { actor_id: 'actor-1', address: '0xabc' },
    ]);

    const strategy: VotingPowerStrategy = {
      computeSnapshot: vi.fn().mockResolvedValue([{ actorId: 'actor-1', power: 10n }]),
      verifyOnChain: vi.fn(),
    };

    const svc = new SnapshotWorkerService(
      repos.proposalRepo as never,
      repos.snapshotRepo as never,
      repos.actorRepo as never,
      repos.runRepo as never,
      repos.dlqRepo as never,
      new Map<string, VotingPowerStrategy>([['compound_governor_bravo', strategy]]),
    );

    await expect(svc.tickOnce()).resolves.toEqual({
      outcome: 'verified',
      proposalId: candidate.id,
    });
    expect(repos.actorRepo.findPrimaryAddressesByActorIds).toHaveBeenCalledWith(['actor-1']);
    expect(repos.snapshotRepo.bulkInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        dao_id: 'dao-1',
        proposal_id: 'proposal-1',
        actor_address: '0xabc',
        voting_power: '10',
        actor_id_hint: 'actor-1',
      }),
    ]);
    expect(repos.runRepo.markCompleted).toHaveBeenCalledWith(
      candidate.id,
      expect.objectContaining({ fallback_engaged: false, rows_inserted: 1 }),
    );
  });

  it('routes to dlq after threshold is reached on error', async () => {
    const repos = makeRepos();
    const candidate = makeCandidate();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue(undefined);
    repos.runRepo.incrementAttempt.mockResolvedValue({ attempts: 5 });

    const strategy: VotingPowerStrategy = {
      computeSnapshot: vi.fn().mockRejectedValue(new Error('boom')),
      verifyOnChain: vi.fn(),
    };

    const svc = new SnapshotWorkerService(
      repos.proposalRepo as never,
      repos.snapshotRepo as never,
      repos.actorRepo as never,
      repos.runRepo as never,
      repos.dlqRepo as never,
      new Map<string, VotingPowerStrategy>([['compound_governor_bravo', strategy]]),
    );

    await expect(svc.tickOnce()).resolves.toEqual({
      outcome: 'dlq',
      proposalId: candidate.id,
    });
    expect(repos.runRepo.markFailed).toHaveBeenCalledWith(
      candidate.id,
      expect.objectContaining({ last_error: 'Error: boom' }),
    );
    expect(repos.dlqRepo.insert).toHaveBeenCalledTimes(1);
  });
});
