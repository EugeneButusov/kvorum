import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { GovernorVoteProjectionApplier } from './governor-vote-projection-applier';
import type { GovernorArchivePayloadRow } from '../persistence/governor-archive-payload-repository';

const BASE_ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'compound_governor_bravo',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'VoteCast',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const BASE_PAYLOAD: GovernorArchivePayloadRow = {
  chain_id: '0x1',
  tx_hash: '0xtx',
  log_index: 1,
  block_hash: '0xblock',
  event_type: 'VoteCast',
  payload: JSON.stringify({
    voter: `0x${'ab'.repeat(20)}`,
    proposalId: '42',
    primaryChoice: 1,
    votingPowerReported: '123',
    compound: { supportRaw: 1, reason: 'reason-from-compound' },
  }),
  received_at: new Date('2026-01-01T00:00:00Z'),
};

interface TestRepositories {
  proposals: {
    findDaoIdForSource: ReturnType<typeof vi.fn>;
    findIdBySource: ReturnType<typeof vi.fn>;
  };
  actors: {
    findIdByAddress: ReturnType<typeof vi.fn>;
  };
  votes: {
    insertVote: ReturnType<typeof vi.fn>;
    insertVoteChoice: ReturnType<typeof vi.fn>;
  };
  archive: {
    markDerived: ReturnType<typeof vi.fn>;
  };
}

interface MutableVoteApplier {
  blockTimestamps: { fetchBatch: ReturnType<typeof vi.fn> };
  registry: { peek: ReturnType<typeof vi.fn> };
  transaction: ReturnType<typeof vi.fn>;
}

function mutable(applier: GovernorVoteProjectionApplier): MutableVoteApplier {
  return applier as unknown as MutableVoteApplier;
}

function buildApplier(options?: { payloads?: GovernorArchivePayloadRow[]; chainCtx?: unknown }) {
  const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const payloads = {
    fetchPayloads: vi.fn().mockResolvedValue(options?.payloads ?? [BASE_PAYLOAD]),
  };
  const metrics = { batchLookupSeconds: vi.fn(), processed: vi.fn() };
  const applier = new GovernorVoteProjectionApplier({
    pgDb: {} as never,
    chDb: {} as never,
    archive: archive as never,
    dlq: dlq as never,
    payloads: payloads as never,
    registry: { peek: vi.fn().mockReturnValue(options?.chainCtx ?? makeChainContext()) } as never,
    metrics,
  });
  mutable(applier).blockTimestamps = {
    fetchBatch: vi.fn().mockResolvedValue(new Map([['100', new Date('2026-01-01T00:01:40Z')]])),
  };
  return { applier, archive, dlq, payloads, metrics };
}

function makeChainContext() {
  return {
    client: { send: vi.fn() },
    chainCfg: { chainId: '0x1' },
  };
}

describe('GovernorVoteProjectionApplier', () => {
  it('exposes VoteCast event type', () => {
    const { applier } = buildApplier();
    expect(applier.eventTypes).toEqual(['VoteCast']);
  });

  it('marks row failed when chain context is missing', async () => {
    const { applier, archive, metrics } = buildApplier();
    mutable(applier).registry = { peek: vi.fn().mockReturnValue(undefined) };

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        reason: 'block_timestamp_unavailable',
      }),
    );
  });

  it('projects vote + choice and marks row derived', async () => {
    const { applier, archive, metrics } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findIdBySource: vi.fn().mockResolvedValue('proposal-1'),
      },
      actors: {
        findIdByAddress: vi.fn().mockResolvedValue('actor-1'),
      },
      votes: {
        insertVote: vi.fn().mockResolvedValue({ inserted: true, voteId: 'vote-1' }),
        insertVoteChoice: vi.fn().mockResolvedValue(undefined),
      },
      archive: {
        markDerived: vi.fn().mockResolvedValue(undefined),
      },
    };
    mutable(applier).transaction = vi.fn(async (fn: (repos: TestRepositories) => Promise<void>) =>
      fn(repositories),
    );

    await applier.applyBatch([BASE_ROW]);

    expect(repositories.votes.insertVote).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal_id: 'proposal-1',
        voter_actor_id: 'actor-1',
        reason: 'reason-from-compound',
      }),
    );
    expect(repositories.votes.insertVoteChoice).toHaveBeenCalledWith('vote-1', {
      choice_index: 1,
      weight: '1.0',
    });
    expect(repositories.archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('marks skipped_idempotent when vote insert is idempotent', async () => {
    const { applier, metrics } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findIdBySource: vi.fn().mockResolvedValue('proposal-1'),
      },
      actors: {
        findIdByAddress: vi.fn().mockResolvedValue('actor-1'),
      },
      votes: {
        insertVote: vi.fn().mockResolvedValue({ inserted: false }),
        insertVoteChoice: vi.fn().mockResolvedValue(undefined),
      },
      archive: {
        markDerived: vi.fn().mockResolvedValue(undefined),
      },
    };
    mutable(applier).transaction = vi.fn(async (fn: (repos: TestRepositories) => Promise<void>) =>
      fn(repositories),
    );

    await applier.applyBatch([BASE_ROW]);

    expect(repositories.votes.insertVoteChoice).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_idempotent', reason: null }),
    );
  });

  it('fails with no_proposal and increments attempts', async () => {
    const { applier, archive, metrics } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findIdBySource: vi.fn().mockResolvedValue(undefined),
      },
      actors: { findIdByAddress: vi.fn() },
      votes: { insertVote: vi.fn(), insertVoteChoice: vi.fn() },
      archive: { markDerived: vi.fn() },
    };
    mutable(applier).transaction = vi.fn(async (fn: (repos: TestRepositories) => Promise<void>) =>
      fn(repositories),
    );

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'no_proposal' }),
    );
  });

  it('fails with no_voter and increments attempts', async () => {
    const { applier, archive, metrics } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findIdBySource: vi.fn().mockResolvedValue('proposal-1'),
      },
      actors: { findIdByAddress: vi.fn().mockResolvedValue(undefined) },
      votes: { insertVote: vi.fn(), insertVoteChoice: vi.fn() },
      archive: { markDerived: vi.fn() },
    };
    mutable(applier).transaction = vi.fn(async (fn: (repos: TestRepositories) => Promise<void>) =>
      fn(repositories),
    );

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'no_voter' }),
    );
  });

  it('routes to vote_projection_stage when threshold is reached', async () => {
    const { applier, dlq } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findIdBySource: vi.fn().mockResolvedValue(undefined),
      },
      actors: { findIdByAddress: vi.fn() },
      votes: { insertVote: vi.fn(), insertVoteChoice: vi.fn() },
      archive: { markDerived: vi.fn() },
    };
    mutable(applier).transaction = vi.fn(async (fn: (repos: TestRepositories) => Promise<void>) =>
      fn(repositories),
    );

    await applier.applyBatch([{ ...BASE_ROW, derivation_attempt_count: 4 }]);

    expect(dlq.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'vote_projection_stage',
      }),
    );
  });

  it('throws on mixed-chain batch', async () => {
    const { applier } = buildApplier();
    await expect(
      applier.applyBatch([BASE_ROW, { ...BASE_ROW, id: 'archive-2', chain_id: '0x89' }]),
    ).rejects.toThrow('vote applier received mixed-chain batch');
  });

  it('caps payload fetch batch at 25', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      ...BASE_ROW,
      id: `archive-${index}`,
      log_index: index,
      tx_hash: `0xtx${index}`,
    }));
    const payloads = rows.map((row) => ({
      ...BASE_PAYLOAD,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
    }));
    const built = buildApplier({ payloads });
    mutable(built.applier).transaction = vi.fn().mockResolvedValue(undefined);

    await built.applier.applyBatch(rows);

    expect(built.payloads.fetchPayloads.mock.calls[0]?.[0]).toHaveLength(25);
  });
});
