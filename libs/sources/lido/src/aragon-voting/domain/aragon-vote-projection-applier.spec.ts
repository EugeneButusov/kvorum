import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AragonVoteProjectionApplier } from './aragon-vote-projection-applier';
import type { AragonVotingArchivePayloadRow } from '../persistence/archive-payload-repository';

const VOTER = '0x' + '22'.repeat(20);
const CAST_AT = new Date('2026-01-01T00:01:40Z');

function makeRow(overrides: Partial<ArchiveDerivationRow>): ArchiveDerivationRow {
  return {
    id: 'archive-1',
    source_type: 'aragon_voting',
    dao_source_id: 'source-1',
    chain_id: '0x1',
    block_number: '100',
    block_hash: '0xblock',
    tx_hash: '0xtx',
    log_index: 1,
    event_type: 'CastVote',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
    ...overrides,
  } as ArchiveDerivationRow;
}

function castVotePayload(supports = true): AragonVotingArchivePayloadRow {
  return {
    chain_id: '0x1',
    tx_hash: '0xtx',
    log_index: 1,
    block_hash: '0xblock',
    event_type: 'CastVote',
    payload: JSON.stringify({ voteId: '42', voter: VOTER, supports, stake: '123' }),
    received_at: new Date('2026-01-01T00:00:00Z'),
  };
}

interface MutableApplier {
  blockTimestamps: {
    fetchBatch: ReturnType<typeof vi.fn>;
    resultKey: (n: string, h: string) => string;
  };
}
function mutable(a: AragonVoteProjectionApplier): MutableApplier {
  return a as unknown as MutableApplier;
}

function buildApplier(opts?: {
  payloads?: AragonVotingArchivePayloadRow[];
  timestamps?: Map<string, Date>;
}) {
  const archive = {
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    markDerived: vi.fn().mockResolvedValue(undefined),
  };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const payloads = {
    fetchPayloads: vi.fn().mockResolvedValue(opts?.payloads ?? [castVotePayload()]),
  };
  const proposals = {
    findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
    findBySource: vi.fn().mockResolvedValue({ id: 'p-1' }),
  };
  const voteRead = { findCurrentVote: vi.fn().mockResolvedValue(undefined) };
  const voteWrite = { insertBatch: vi.fn().mockResolvedValue(undefined) };
  const registry = {
    peek: vi.fn().mockReturnValue({ client: { send: vi.fn() }, chainCfg: { chainId: '0x1' } }),
  };
  const metrics = { batchLookupSeconds: vi.fn(), chWriteSeconds: vi.fn(), processed: vi.fn() };

  const applier = new AragonVoteProjectionApplier({
    archive: archive as never,
    dlq: dlq as never,
    payloads: payloads as never,
    proposals: proposals as never,
    voteRead: voteRead as never,
    voteWrite: voteWrite as never,
    registry: registry as never,
    metrics,
  });
  mutable(applier).blockTimestamps = {
    fetchBatch: vi.fn().mockResolvedValue(opts?.timestamps ?? new Map([['100:0xblock', CAST_AT]])),
    resultKey: (n: string, h: string) => `${n}:${h}`,
  };
  return { applier, archive, dlq, payloads, proposals, voteRead, voteWrite, registry, metrics };
}

describe('AragonVoteProjectionApplier', () => {
  it('declares the CastVote + CastObjection contract', () => {
    const { applier } = buildApplier();
    expect(applier.kind).toBe('projection');
    expect([...applier.sourceTypes]).toEqual(['aragon_voting']);
    expect([...applier.eventTypes]).toEqual(['CastVote', 'CastObjection']);
  });

  it('returns early on an empty batch', async () => {
    const { applier, payloads, registry } = buildApplier();
    await applier.applyBatch([]);
    expect(payloads.fetchPayloads).not.toHaveBeenCalled();
    expect(registry.peek).not.toHaveBeenCalled();
  });

  it('dedupes CastObjection markers: marks derived, no vote row, no payload fetch', async () => {
    const { applier, archive, payloads, voteWrite, registry, metrics } = buildApplier();
    await applier.applyBatch([makeRow({ event_type: 'CastObjection' })]);

    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(payloads.fetchPayloads).not.toHaveBeenCalled();
    expect(registry.peek).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'CastObjection', outcome: 'skipped_objection_marker' }),
    );
  });

  it('fails CastVote rows with block_timestamp_unavailable when chain context is missing', async () => {
    const { applier, archive, registry, metrics } = buildApplier();
    registry.peek.mockReturnValue(undefined);
    await applier.applyBatch([makeRow({ event_type: 'CastVote' })]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'block_timestamp_unavailable' }),
    );
  });

  it('derives a first CastVote into a single vote row', async () => {
    const { applier, voteWrite, archive, metrics } = buildApplier();
    await applier.applyBatch([makeRow({ event_type: 'CastVote' })]);

    expect(voteWrite.insertBatch).toHaveBeenCalledTimes(1);
    const rows = voteWrite.insertBatch.mock.calls[0]![0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ primary_choice: 1, voting_power: '123', superseded: 0 });
    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'derived' }));
  });

  it('supersedes a prior current vote when a newer CastVote arrives (Yes→No flip)', async () => {
    const { applier, voteRead, voteWrite } = buildApplier({ payloads: [castVotePayload(false)] });
    voteRead.findCurrentVote.mockResolvedValue({
      vote_id: 'old-vote',
      cast_at: new Date('2026-01-01T00:00:00Z'), // older than CAST_AT
      block_number: '99',
      log_index: 0,
      primary_choice: 1,
      voting_power: '123',
      voting_chain_id: '0x1',
    });
    await applier.applyBatch([makeRow({ event_type: 'CastVote' })]);

    const rows = voteWrite.insertBatch.mock.calls[0]![0];
    expect(rows).toHaveLength(2); // incoming No (superseded 0) + re-issued Yes (superseded 1)
    expect(rows.find((r: { superseded: number }) => r.superseded === 0)).toMatchObject({
      primary_choice: 0,
    });
    expect(rows.find((r: { superseded: number }) => r.superseded === 1)).toMatchObject({
      superseded_by_vote_id: 'archive-1',
    });
  });

  it('skips re-deriving the already-current vote (idempotent, no write)', async () => {
    const { applier, voteRead, voteWrite, archive, metrics } = buildApplier();
    voteRead.findCurrentVote.mockResolvedValue({
      vote_id: 'archive-1',
      cast_at: CAST_AT,
      block_number: '100',
      log_index: 1,
      primary_choice: 1,
      voting_power: '123',
      voting_chain_id: '0x1',
    });
    await applier.applyBatch([makeRow({ event_type: 'CastVote' })]);

    expect(voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_idempotent' }),
    );
  });

  it('fails with no_proposal when the proposal is not yet derived', async () => {
    const { applier, proposals, metrics } = buildApplier();
    proposals.findBySource.mockResolvedValue(undefined);
    await applier.applyBatch([makeRow({ event_type: 'CastVote' })]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'no_proposal' }),
    );
  });

  it('fails with payload_missing when the CH payload is absent', async () => {
    const { applier, metrics } = buildApplier({ payloads: [] });
    await applier.applyBatch([makeRow({ event_type: 'CastVote' })]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'payload_missing' }),
    );
  });

  it('fails a row when its block timestamp is unavailable', async () => {
    const { applier, metrics } = buildApplier({ timestamps: new Map() });
    await applier.applyBatch([makeRow({ event_type: 'CastVote' })]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'block_timestamp_unavailable' }),
    );
  });

  it('routes to vote_projection_stage DLQ at the attempt threshold', async () => {
    const { applier, dlq, proposals } = buildApplier();
    proposals.findBySource.mockResolvedValue(undefined);
    await applier.applyBatch([makeRow({ event_type: 'CastVote', derivation_attempt_count: 4 })]);

    expect(dlq.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'vote_projection_stage' }),
    );
  });
});
