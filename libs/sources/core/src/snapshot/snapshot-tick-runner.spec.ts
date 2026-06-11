import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VotingPowerStrategy } from '@libs/domain';
import type { SourceSnapshotStrategy } from '../index';
import { buildSnapshotStrategies, SnapshotTickRunner } from './snapshot-tick-runner';

function makeEntry(strategy: VotingPowerStrategy): SourceSnapshotStrategy {
  return { sourceTypes: [], strategy };
}

function makeRepos() {
  return {
    proposalRepo: {
      findNextSnapshotCandidate: vi.fn(),
    },
    snapshotRepo: { bulkInsert: vi.fn() },
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

describe('SnapshotTickRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns idle when there is no candidate', async () => {
    const repos = makeRepos();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(undefined);
    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map([['compound_governor_bravo', makeEntry({ computeSnapshot: vi.fn() })]]),
    });

    await expect(runner.tickOnce()).resolves.toEqual({ outcome: 'idle' });
    expect(repos.proposalRepo.findNextSnapshotCandidate).toHaveBeenCalledWith(
      ['compound_governor_bravo'],
      ['active', 'succeeded', 'defeated', 'queued', 'executed', 'expired', 'vetoed'],
      5,
      [],
    );
  });

  it('marks run as failed when no strategy is registered for candidate source', async () => {
    const repos = makeRepos();
    const candidate = makeCandidate();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue(undefined);
    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map(),
    });

    await expect(runner.tickOnce()).resolves.toEqual({
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
    const metrics = {
      populationSize: vi.fn(),
      proposalsProcessed: vi.fn(),
    };
    const candidate = makeCandidate();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue(undefined);

    const strategy: VotingPowerStrategy = {
      computeSnapshot: vi
        .fn()
        .mockResolvedValue([{ actorId: 'actor-1', address: '0xabc', power: 10n }]),
    };

    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map([['compound_governor_bravo', makeEntry(strategy)]]),
      metrics,
    });

    await expect(runner.tickOnce()).resolves.toEqual({
      outcome: 'verified',
      proposalId: candidate.id,
    });
    expect(strategy.computeSnapshot).toHaveBeenCalledWith(123n, {
      daoId: 'dao-1',
      proposalId: 'proposal-1',
    });
    expect(repos.snapshotRepo.bulkInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        dao_id: 'dao-1',
        proposal_id: 'proposal-1',
        actor_address: '0xabc',
        voter_address: '0xabc',
        voting_power: '10',
        actor_id_hint: 'actor-1',
      }),
    ]);
    expect(repos.runRepo.markCompleted).toHaveBeenCalledWith(
      candidate.id,
      expect.objectContaining({ fallback_engaged: false, rows_inserted: 1, sample_size: 0 }),
    );
    expect(metrics.populationSize).toHaveBeenCalledWith(1);
    expect(metrics.proposalsProcessed).toHaveBeenCalledWith('verified');
  });

  it('calls touchAttempt when an in_progress run already exists', async () => {
    const repos = makeRepos();
    const candidate = makeCandidate();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue({ status: 'in_progress' });

    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map([
        [
          'compound_governor_bravo',
          makeEntry({
            computeSnapshot: vi
              .fn()
              .mockResolvedValue([{ actorId: 'actor-1', address: '0xabc', power: 5n }]),
          }),
        ],
      ]),
    });

    await runner.tickOnce();

    expect(repos.runRepo.touchAttempt).toHaveBeenCalledWith(candidate.id, expect.any(Date));
    expect(repos.runRepo.insertInProgress).not.toHaveBeenCalled();
  });

  it('returns empty_population when strategy computes zero rows', async () => {
    const repos = makeRepos();
    const metrics = {
      populationSize: vi.fn(),
      proposalsProcessed: vi.fn(),
    };
    const candidate = makeCandidate();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue(undefined);

    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map([
        ['compound_governor_bravo', makeEntry({ computeSnapshot: vi.fn().mockResolvedValue([]) })],
      ]),
      metrics,
    });

    await expect(runner.tickOnce()).resolves.toEqual({
      outcome: 'empty_population',
      proposalId: candidate.id,
    });
    expect(repos.snapshotRepo.bulkInsert).not.toHaveBeenCalled();
    expect(metrics.populationSize).toHaveBeenCalledWith(0);
    expect(metrics.proposalsProcessed).toHaveBeenCalledWith('empty_population');
  });

  it('stores a distinct voter_address when strategy returns votingAddress', async () => {
    const repos = makeRepos();
    const candidate = { ...makeCandidate(), source_type: 'aave_governance_v3' };
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue(undefined);

    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map([
        [
          'aave_governance_v3',
          makeEntry({
            computeSnapshot: vi.fn().mockResolvedValue([
              {
                actorId: 'actor-1',
                address: '0xprimary',
                votingAddress: '0xvote',
                power: 10n,
              },
            ]),
          }),
        ],
      ]),
    });

    await runner.tickOnce();

    expect(repos.snapshotRepo.bulkInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        actor_address: '0xprimary',
        voter_address: '0xvote',
      }),
    ]);
  });

  it('returns retry with proposalId when error occurs and attempts are below threshold', async () => {
    const repos = makeRepos();
    const candidate = makeCandidate();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue(undefined);
    repos.runRepo.incrementAttempt.mockResolvedValue({ attempts: 2 });

    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map([
        [
          'compound_governor_bravo',
          makeEntry({ computeSnapshot: vi.fn().mockRejectedValue(new Error('transient')) }),
        ],
      ]),
    });

    await expect(runner.tickOnce()).resolves.toEqual({
      outcome: 'retry',
      proposalId: candidate.id,
    });
    expect(repos.dlqRepo.insert).not.toHaveBeenCalled();
  });

  it('returns retry without proposalId when error occurs before candidate is fetched', async () => {
    const repos = makeRepos();
    repos.proposalRepo.findNextSnapshotCandidate.mockRejectedValue(new Error('db down'));

    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map(),
    });

    await expect(runner.tickOnce()).resolves.toEqual({ outcome: 'retry' });
  });

  it('routes to dlq after threshold is reached on error', async () => {
    const repos = makeRepos();
    const candidate = makeCandidate();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(candidate);
    repos.runRepo.findByProposalId.mockResolvedValue(undefined);
    repos.runRepo.incrementAttempt.mockResolvedValue({ attempts: 5 });

    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map([
        [
          'compound_governor_bravo',
          makeEntry({ computeSnapshot: vi.fn().mockRejectedValue(new Error('boom')) }),
        ],
      ]),
    });

    await expect(runner.tickOnce()).resolves.toEqual({
      outcome: 'dlq',
      proposalId: candidate.id,
    });
    expect(repos.runRepo.markFailed).toHaveBeenCalledWith(
      candidate.id,
      expect.objectContaining({ last_error: 'Error: boom' }),
    );
    expect(repos.dlqRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('includes blocked proposal ids from distinct strategy entries', async () => {
    const repos = makeRepos();
    repos.proposalRepo.findNextSnapshotCandidate.mockResolvedValue(undefined);
    const getBlockedProposalIds = vi.fn().mockResolvedValue(['p-1']);

    const runner = new SnapshotTickRunner({
      proposalRepo: repos.proposalRepo as never,
      snapshotRepo: repos.snapshotRepo as never,
      runRepo: repos.runRepo as never,
      dlqRepo: repos.dlqRepo as never,
      strategies: new Map([
        [
          'a',
          { sourceTypes: ['a'], strategy: { computeSnapshot: vi.fn() }, getBlockedProposalIds },
        ],
        [
          'b',
          { sourceTypes: ['b'], strategy: { computeSnapshot: vi.fn() }, getBlockedProposalIds },
        ],
      ]),
    });

    await runner.tickOnce();

    expect(getBlockedProposalIds).toHaveBeenCalledTimes(2);
    expect(repos.proposalRepo.findNextSnapshotCandidate).toHaveBeenCalledWith(
      ['a', 'b'],
      ['active', 'succeeded', 'defeated', 'queued', 'executed', 'expired', 'vetoed'],
      5,
      ['p-1', 'p-1'],
    );
  });
});

describe('buildSnapshotStrategies', () => {
  it('maps snapshotStrategies from plugins', () => {
    const strategy = { computeSnapshot: vi.fn() };
    const plugin = {
      name: 'test',
      ingesters: [],
      derivers: [],
      snapshotStrategies: [
        { sourceTypes: ['compound_governor_bravo', 'compound_governor_alpha'], strategy },
      ],
    };

    const result = buildSnapshotStrategies([plugin]);

    expect(result.size).toBe(2);
    expect(result.get('compound_governor_bravo')?.strategy).toBe(strategy);
    expect(result.get('compound_governor_alpha')?.strategy).toBe(strategy);
  });
});
