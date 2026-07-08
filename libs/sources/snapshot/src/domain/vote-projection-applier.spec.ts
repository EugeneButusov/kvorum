import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OffchainArchiveRow } from '@libs/db';
import type { SnapshotVotePayload } from './types';
import { SnapshotVoteProjectionApplier } from './vote-projection-applier';

const VOTER = '0x' + 'ab'.repeat(20);

const ROW: OffchainArchiveRow = {
  id: 'r1',
  source_type: 'snapshot',
  dao_source_id: 'src-1',
  chain_id: 'off-chain',
  external_id: 'vote:0xv',
  derivation_ordinal: '1700000000',
  event_type: 'SnapshotVoteCast',
  received_at: new Date(),
  derivation_attempt_count: 0,
};

function payload(overrides: Partial<SnapshotVotePayload> = {}): SnapshotVotePayload {
  return {
    id: '0xv',
    voter: VOTER,
    created: 1_700_000_000,
    choice: 1,
    vp: 100,
    vp_by_strategy: [100],
    proposal: { id: '0xprop' },
    ...overrides,
  };
}

function makeDeps(p: SnapshotVotePayload) {
  return {
    payloads: {
      fetchLatest: vi
        .fn()
        .mockResolvedValue([{ external_id: 'vote:0xv', payload: JSON.stringify(p) }]),
      // Default: the parent proposal is not archived → orphan votes retry (not skipped).
      fetchByExternalId: vi.fn().mockResolvedValue(undefined),
    },
    proposals: {
      findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
      findBySource: vi.fn().mockResolvedValue({ id: 'p-1' }),
    },
    snapshotProposals: {
      findMetadata: vi
        .fn()
        .mockResolvedValue({ voting_type: 'single-choice', network: '137', choice_count: 3 }),
    },
    voteRead: { findCurrentVote: vi.fn().mockResolvedValue(undefined) },
    voteWrite: { insertBatch: vi.fn().mockResolvedValue(undefined) },
    voteChoice: {
      insert: vi.fn().mockResolvedValue(undefined),
      existsForVote: vi.fn().mockResolvedValue(false),
    },
    archive: {
      markDerived: vi.fn().mockResolvedValue(undefined),
      incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    },
    logger: { error: vi.fn() },
  };
}

describe('SnapshotVoteProjectionApplier', () => {
  let deps: ReturnType<typeof makeDeps>;
  const build = (p: SnapshotVotePayload) => {
    deps = makeDeps(p);
    return new SnapshotVoteProjectionApplier(deps as never);
  };

  beforeEach(() => vi.clearAllMocks());

  it('derives a new single-choice vote into vote_events + the protocol table', async () => {
    const applier = build(payload());
    await applier.applyBatch([ROW]);

    expect(deps.voteChoice.insert).toHaveBeenCalledWith({
      voteId: 'r1',
      choices: [{ choice_index: 0, weight: '1.0' }],
      vp: '100',
      vpByStrategy: [100],
    });
    expect(deps.voteWrite.insertBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        vote_id: 'r1',
        dao_id: 'dao-1',
        proposal_id: 'p-1',
        voter_address: VOTER,
        primary_choice: 0,
        voting_power: '100',
        voting_chain_id: '0x89', // network 137 → hex
        superseded: 0,
      }),
    ]);
    expect(deps.archive.markDerived).toHaveBeenCalledWith('r1');
  });

  it('supersedes the current vote on a re-cast (2-row batch)', async () => {
    const applier = build(payload({ created: 1_700_000_900 }));
    deps.voteRead.findCurrentVote.mockResolvedValue({
      vote_id: 'old',
      cast_at: new Date(1_700_000_000 * 1000),
      block_number: '0',
      log_index: 0,
      primary_choice: 1,
      voting_power: '50',
      voting_chain_id: '0x89',
    });

    await applier.applyBatch([ROW]);

    const rows = deps.voteWrite.insertBatch.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.vote_id === 'r1')!.superseded).toBe(0);
    expect(rows.find((r) => r.vote_id === 'old')!.superseded).toBe(1);
  });

  it('is idempotent for the already-current vote and backfills a missing protocol row', async () => {
    const applier = build(payload());
    deps.voteRead.findCurrentVote.mockResolvedValue({ vote_id: 'r1', cast_at: new Date() });
    deps.voteChoice.existsForVote.mockResolvedValue(false);

    await applier.applyBatch([ROW]);

    expect(deps.voteChoice.insert).toHaveBeenCalledWith(expect.objectContaining({ voteId: 'r1' }));
    expect(deps.voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(deps.archive.markDerived).toHaveBeenCalledWith('r1');
  });

  it('does not double-write the protocol row when it already exists (idempotent)', async () => {
    const applier = build(payload());
    deps.voteRead.findCurrentVote.mockResolvedValue({ vote_id: 'r1', cast_at: new Date() });
    deps.voteChoice.existsForVote.mockResolvedValue(true);

    await applier.applyBatch([ROW]);

    expect(deps.voteChoice.insert).not.toHaveBeenCalled();
    expect(deps.archive.markDerived).toHaveBeenCalledWith('r1');
  });

  it('skips a shielded/undecodable choice but marks it derived', async () => {
    const applier = build(payload({ choice: '0xencrypted' }));
    await applier.applyBatch([ROW]);

    expect(deps.voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(deps.voteChoice.insert).not.toHaveBeenCalled();
    expect(deps.archive.markDerived).toHaveBeenCalledWith('r1');
  });

  it('retries when the proposal has no row and is not yet archived (genuinely pending)', async () => {
    const applier = build(payload());
    deps.proposals.findBySource.mockResolvedValue(undefined);
    // fetchByExternalId defaults to undefined → parent not archived → retry, don't skip.

    await applier.applyBatch([ROW]);

    expect(deps.payloads.fetchByExternalId).toHaveBeenCalledWith('prop:0xprop');
    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
    expect(deps.archive.markDerived).not.toHaveBeenCalled();
  });

  it('retries an orphan vote whose parent proposal is archived but NOT flagged/deleted', async () => {
    const applier = build(payload());
    deps.proposals.findBySource.mockResolvedValue(undefined);
    deps.payloads.fetchByExternalId.mockResolvedValue(
      JSON.stringify({ id: '0xprop', flagged: false }),
    );

    await applier.applyBatch([ROW]);

    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
    expect(deps.archive.markDerived).not.toHaveBeenCalled();
  });

  it('retries an orphan vote whose parent proposal payload is malformed JSON (cannot classify)', async () => {
    const applier = build(payload());
    deps.proposals.findBySource.mockResolvedValue(undefined);
    deps.payloads.fetchByExternalId.mockResolvedValue('not json');

    await applier.applyBatch([ROW]);

    expect(deps.archive.markDerived).not.toHaveBeenCalled();
    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
  });

  it('skips (marks derived) an orphan vote whose parent proposal is flagged — poison guard', async () => {
    const applier = build(payload());
    deps.proposals.findBySource.mockResolvedValue(undefined);
    deps.payloads.fetchByExternalId.mockResolvedValue(
      JSON.stringify({ id: '0xprop', flagged: true }),
    );

    await applier.applyBatch([ROW]);

    expect(deps.archive.markDerived).toHaveBeenCalledWith('r1');
    expect(deps.archive.incrementAttemptCount).not.toHaveBeenCalled();
  });

  it('skips an orphan vote whose parent proposal is deleted — poison guard', async () => {
    const applier = build(payload());
    deps.proposals.findBySource.mockResolvedValue(undefined);
    deps.payloads.fetchByExternalId.mockResolvedValue(
      JSON.stringify({ id: '0xprop', deleted: true }),
    );

    await applier.applyBatch([ROW]);

    expect(deps.archive.markDerived).toHaveBeenCalledWith('r1');
    expect(deps.archive.incrementAttemptCount).not.toHaveBeenCalled();
  });

  it('fails when the archive payload is missing', async () => {
    const applier = build(payload());
    deps.payloads.fetchLatest.mockResolvedValue([]);

    await applier.applyBatch([ROW]);

    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
  });

  it('fails when the voter is not a 42-char address', async () => {
    const applier = build(payload({ voter: '0xabc' }));
    await applier.applyBatch([ROW]);
    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
  });

  it('fails on an undecodable archive payload (bad JSON)', async () => {
    const applier = build(payload());
    deps.payloads.fetchLatest.mockResolvedValue([{ external_id: 'vote:0xv', payload: 'not json' }]);
    await applier.applyBatch([ROW]);
    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
  });

  it('fails when the vote payload omits the proposal reference', async () => {
    const applier = build(payload({ proposal: null }));
    await applier.applyBatch([ROW]);
    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
    expect(deps.archive.markDerived).not.toHaveBeenCalled();
  });

  it('ignores an empty batch', async () => {
    const applier = build(payload());
    await applier.applyBatch([]);
    expect(deps.payloads.fetchLatest).not.toHaveBeenCalled();
  });
});
