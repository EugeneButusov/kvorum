import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import {
  GovernorVoteProjectionApplier,
  type GovernorVoteProjectionApplierDeps,
} from './governor-vote-projection-applier';
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
    findBySource: ReturnType<typeof vi.fn>;
  };
  actors: {
    findByAddress: ReturnType<typeof vi.fn>;
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
  blockTimestamps: {
    fetchBatch: ReturnType<typeof vi.fn>;
    resultKey: (n: string, h: string) => string;
  };
  registry: { peek: ReturnType<typeof vi.fn> };
  transaction: ReturnType<typeof vi.fn>;
}

function mutable(applier: GovernorVoteProjectionApplier): MutableVoteApplier {
  return applier as unknown as MutableVoteApplier;
}

function buildApplier(options?: { payloads?: GovernorArchivePayloadRow[]; chainCtx?: unknown }) {
  const archive: GovernorVoteProjectionApplierDeps['archive'] = {
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
  } as unknown as GovernorVoteProjectionApplierDeps['archive'];
  const dlq: GovernorVoteProjectionApplierDeps['dlq'] = {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as GovernorVoteProjectionApplierDeps['dlq'];
  const payloads: GovernorVoteProjectionApplierDeps['payloads'] = {
    fetchPayloads: vi.fn().mockResolvedValue(options?.payloads ?? [BASE_PAYLOAD]),
  } as unknown as GovernorVoteProjectionApplierDeps['payloads'];
  const metrics = { batchLookupSeconds: vi.fn(), processed: vi.fn() };
  const proposals: GovernorVoteProjectionApplierDeps['proposals'] = {
    findDaoIdForSource: vi.fn(),
    findBySource: vi.fn(),
  } as unknown as GovernorVoteProjectionApplierDeps['proposals'];
  const voteRead: GovernorVoteProjectionApplierDeps['voteRead'] = {
    findCurrentVote: vi.fn(),
  } as unknown as GovernorVoteProjectionApplierDeps['voteRead'];
  const voteWrite: GovernorVoteProjectionApplierDeps['voteWrite'] = {
    insertBatch: vi.fn(),
  } as unknown as GovernorVoteProjectionApplierDeps['voteWrite'];
  const registry: GovernorVoteProjectionApplierDeps['registry'] = {
    peek: vi.fn().mockReturnValue(options?.chainCtx ?? makeChainContext()),
  } as unknown as GovernorVoteProjectionApplierDeps['registry'];
  const applier = new GovernorVoteProjectionApplier({
    proposals,
    voteRead,
    voteWrite,
    archive,
    dlq,
    payloads,
    registry,
    metrics,
  });
  mutable(applier).blockTimestamps = {
    fetchBatch: vi
      .fn()
      .mockResolvedValue(new Map([['100:0xblock', new Date('2026-01-01T00:01:40Z')]])),
    resultKey: (blockNumber: string, blockHash: string) => `${blockNumber}:${blockHash}`,
  };
  return { applier, archive, dlq, payloads, metrics };
}

function makeChainContext() {
  return {
    client: { send: vi.fn().mockResolvedValue('0x1000') },
    chainCfg: { chainId: '0x1', headLag: 12 },
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

  it('records projection_apply_error when proposal/db path is unavailable', async () => {
    const { applier, archive, metrics } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findBySource: vi.fn().mockResolvedValue({ id: 'proposal-1' }),
      },
      actors: {
        findByAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }),
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

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });

  it('marks skipped_idempotent when vote insert is idempotent', async () => {
    const { applier, metrics } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findBySource: vi.fn().mockResolvedValue({ id: 'proposal-1' }),
      },
      actors: {
        findByAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }),
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

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });

  it('fails with no_proposal and increments attempts', async () => {
    const { applier, archive, metrics } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findBySource: vi.fn().mockResolvedValue(undefined),
      },
      actors: { findByAddress: vi.fn() },
      votes: { insertVote: vi.fn(), insertVoteChoice: vi.fn() },
      archive: { markDerived: vi.fn() },
    };
    mutable(applier).transaction = vi.fn(async (fn: (repos: TestRepositories) => Promise<void>) =>
      fn(repositories),
    );

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });

  it('fails with projection_apply_error and increments attempts', async () => {
    const { applier, archive, metrics } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findBySource: vi.fn().mockResolvedValue({ id: 'proposal-1' }),
      },
      actors: { findByAddress: vi.fn().mockResolvedValue(undefined) },
      votes: { insertVote: vi.fn(), insertVoteChoice: vi.fn() },
      archive: { markDerived: vi.fn() },
    };
    mutable(applier).transaction = vi.fn(async (fn: (repos: TestRepositories) => Promise<void>) =>
      fn(repositories),
    );

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });

  it('routes to vote_projection_stage when threshold is reached', async () => {
    const { applier, dlq } = buildApplier();
    const repositories: TestRepositories = {
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
        findBySource: vi.fn().mockResolvedValue(undefined),
      },
      actors: { findByAddress: vi.fn() },
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
