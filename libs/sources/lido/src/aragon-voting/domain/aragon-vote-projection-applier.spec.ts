import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AragonVoteProjectionApplier } from './aragon-vote-projection-applier';

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

function makeMetrics() {
  return { batchLookupSeconds: vi.fn(), chWriteSeconds: vi.fn(), processed: vi.fn() };
}

describe('AragonVoteProjectionApplier', () => {
  it('declares the CastVote + CastObjection contract', () => {
    const applier = new AragonVoteProjectionApplier({} as never);
    expect(applier.kind).toBe('projection');
    expect([...applier.sourceTypes]).toEqual(['aragon_voting']);
    expect([...applier.eventTypes]).toEqual(['CastVote', 'CastObjection']);
  });

  it('dedupes CastObjection markers: marks derived, no vote row, no payload fetch', async () => {
    const archive = {
      markDerived: vi.fn().mockResolvedValue(undefined),
      incrementAttemptCount: vi.fn(),
    };
    const payloads = { fetchPayloads: vi.fn() };
    const voteWrite = { insertBatch: vi.fn() };
    const registry = { peek: vi.fn() };
    const metrics = makeMetrics();

    const applier = new AragonVoteProjectionApplier({
      archive: archive as never,
      dlq: {} as never,
      payloads: payloads as never,
      proposals: {} as never,
      voteRead: {} as never,
      voteWrite: voteWrite as never,
      registry: registry as never,
      metrics,
    });

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
    const archive = {
      markDerived: vi.fn(),
      incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    };
    const registry = { peek: vi.fn().mockReturnValue(undefined) };
    const metrics = makeMetrics();

    const applier = new AragonVoteProjectionApplier({
      archive: archive as never,
      dlq: {} as never,
      payloads: { fetchPayloads: vi.fn() } as never,
      proposals: {} as never,
      voteRead: {} as never,
      voteWrite: {} as never,
      registry: registry as never,
      metrics,
    });

    await applier.applyBatch([makeRow({ event_type: 'CastVote' })]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'block_timestamp_unavailable' }),
    );
  });
});
