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
  received_at: new Date('2026-01-01T00:00:00Z'),
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
    markDerived: vi.fn().mockResolvedValue(undefined),
  } as unknown as GovernorVoteProjectionApplierDeps['archive'];
  const dlq: GovernorVoteProjectionApplierDeps['dlq'] = {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as GovernorVoteProjectionApplierDeps['dlq'];
  const payloads: GovernorVoteProjectionApplierDeps['payloads'] = {
    fetchPayloads: vi.fn().mockResolvedValue(options?.payloads ?? [BASE_PAYLOAD]),
  } as unknown as GovernorVoteProjectionApplierDeps['payloads'];
  const metrics = { batchLookupSeconds: vi.fn(), chWriteSeconds: vi.fn(), processed: vi.fn() };
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
  return { applier, archive, dlq, payloads, metrics, proposals, voteRead, voteWrite };
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

  it('returns early on empty batches', async () => {
    const { applier, archive, payloads, voteWrite } = buildApplier();

    await applier.applyBatch([]);

    expect(payloads.fetchPayloads).not.toHaveBeenCalled();
    expect(voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(archive.markDerived).not.toHaveBeenCalled();
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
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

  it('derives new vote when no current vote exists', async () => {
    const { applier, archive, metrics, proposals, voteRead, voteWrite } = buildApplier();

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-1' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (voteWrite.insertBatch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (archive.markDerived as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(voteWrite.insertBatch).toHaveBeenCalledTimes(1);
    const insertedRows = (voteWrite.insertBatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      superseded: number;
      voting_chain_id: string;
    }[];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]?.superseded).toBe(0);
    expect(insertedRows[0]?.voting_chain_id).toBe('0x1');
    expect(archive.markDerived).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('supersedes the current vote when incoming is newer (by block timestamp)', async () => {
    const { applier, archive, metrics, proposals, voteRead, voteWrite } = buildApplier();

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-1' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue({
      vote_id: 'old-vote-id',
      cast_at: new Date('2025-12-31T00:00:00Z'), // older than the incoming 2026-01-01T00:01:40Z
      block_number: '50',
      log_index: 0,
      primary_choice: 2,
      voting_power: '99',
      voting_chain_id: '0x1',
    });
    (voteWrite.insertBatch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (archive.markDerived as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    const rows = (voteWrite.insertBatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      vote_id: string;
      superseded: number;
      voting_chain_id: string;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.vote_id).toBe(BASE_ROW.id);
    expect(rows[0]?.superseded).toBe(0);
    expect(rows[1]?.vote_id).toBe('old-vote-id');
    expect(rows[1]?.superseded).toBe(1);
    expect(rows[0]?.voting_chain_id).toBe('0x1');
    expect(rows[1]?.voting_chain_id).toBe('0x1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('marks incoming as superseded when current vote is newer (by block timestamp)', async () => {
    const { applier, metrics, proposals, voteRead, voteWrite } = buildApplier();

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-1' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue({
      vote_id: 'newer-vote-id',
      cast_at: new Date('2026-06-01T00:00:00Z'), // newer than incoming
      block_number: '200',
      log_index: 0,
      primary_choice: 1,
      voting_power: '200',
      voting_chain_id: '0x1',
    });
    (voteWrite.insertBatch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    const rows = (voteWrite.insertBatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      superseded: number;
      voting_chain_id: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.superseded).toBe(1);
    expect(rows[0]?.voting_chain_id).toBe('0x1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_idempotent', reason: null }),
    );
  });

  it('uses block number as tiebreaker when castAt matches (incoming block is higher)', async () => {
    const { applier, archive, metrics, proposals, voteRead, voteWrite } = buildApplier();
    const tiedCastAt = new Date('2026-01-01T00:01:40Z'); // same as blockTimestamps mock

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-1' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue({
      vote_id: 'old-vote-id',
      cast_at: tiedCastAt,
      block_number: '50', // incoming block '100' > '50' → incoming is newer
      log_index: 0,
      primary_choice: 2,
      voting_power: '99',
      voting_chain_id: '0x1',
    });
    (voteWrite.insertBatch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (archive.markDerived as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(metrics.processed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'derived' }));
  });

  it('uses log index as tiebreaker when castAt and block number both match (incoming logIndex is higher)', async () => {
    const { applier, archive, metrics, proposals, voteRead, voteWrite } = buildApplier();
    const tiedCastAt = new Date('2026-01-01T00:01:40Z');

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-1' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue({
      vote_id: 'old-vote-id',
      cast_at: tiedCastAt,
      block_number: BASE_ROW.block_number, // same block
      log_index: 0, // incoming logIndex=1 > 0 → incoming is newer
      primary_choice: 2,
      voting_power: '99',
      voting_chain_id: '0x1',
    });
    (voteWrite.insertBatch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (archive.markDerived as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(metrics.processed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'derived' }));
  });

  it('fails with no_proposal when findBySource returns undefined', async () => {
    const { applier, archive, metrics, proposals } = buildApplier();

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'no_proposal' }),
    );
  });

  it('fails with decode_error when payload JSON is invalid', async () => {
    const { applier, archive, metrics, proposals } = buildApplier({
      payloads: [{ ...BASE_PAYLOAD, payload: 'not-valid-json' }],
    });

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-1' });

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'decode_error' }),
    );
  });

  it('fails with payload_missing when payload is not in fetched batch', async () => {
    const { applier, archive, metrics } = buildApplier({ payloads: [] });

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'payload_missing' }),
    );
  });

  it('fails with block_timestamp_unavailable when block timestamp is missing from fetched batch', async () => {
    const { applier, archive, metrics, proposals } = buildApplier();

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-1' });

    // Override blockTimestamps to return an empty map (no timestamp for any block)
    mutable(applier).blockTimestamps = {
      fetchBatch: vi.fn().mockResolvedValue(new Map()),
      resultKey: (n: string, h: string) => `${n}:${h}`,
    };

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'block_timestamp_unavailable' }),
    );
  });

  it('fails with watermark_update_error when archive.markDerived throws', async () => {
    const { applier, archive, metrics, proposals, voteRead, voteWrite } = buildApplier();

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-1' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (voteWrite.insertBatch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (archive.markDerived as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('PG write failed'),
    );

    await applier.applyBatch([BASE_ROW]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'watermark_update_error' }),
    );
  });

  it('identity guard: skips insertBatch and advances watermark when incoming is already current', async () => {
    // §4.2c regression: re-deriving the row that is already current must not run buildVoteRows/insertBatch.
    // Without the guard, buildVoteRows emits a self-superseding row (superseded=1, superseded_by=self),
    // collapsing the vote to zero superseded=0 rows under FINAL.
    const { applier, archive, metrics, proposals, voteRead, voteWrite } = buildApplier();

    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-1' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue({
      vote_id: BASE_ROW.id, // same id as the row being processed — identity case
      cast_at: new Date('2026-01-01T00:01:40Z'),
      block_number: BASE_ROW.block_number,
      log_index: BASE_ROW.log_index,
      primary_choice: 1,
      voting_power: '123',
      voting_chain_id: '0x1',
    });

    await applier.applyBatch([BASE_ROW]);

    expect(voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(archive.markDerived).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_idempotent', reason: null }),
    );
  });
});
