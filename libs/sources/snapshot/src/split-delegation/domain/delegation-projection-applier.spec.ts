import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { SplitDelegationProjectionApplier } from './delegation-projection-applier';
import type { SplitDelegationArchivePayloadRow } from '../persistence/archive-payload-repository';

const D1 = `0x${'00'.repeat(12)}${'22'.repeat(20)}`;

function baseRow(overrides: Partial<ArchiveDerivationRow> = {}): ArchiveDerivationRow {
  return {
    id: 'archive-1',
    source_type: 'snapshot_split_delegation',
    dao_source_id: 'src-1',
    chain_id: '0x1',
    block_number: '200',
    block_hash: '0xblock',
    tx_hash: '0xtx',
    log_index: 1,
    event_type: 'DelegationUpdated',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
    ...overrides,
  };
}

function payloadFor(row: ArchiveDerivationRow, payload: unknown): SplitDelegationArchivePayloadRow {
  return {
    chain_id: row.chain_id,
    tx_hash: row.tx_hash,
    log_index: row.log_index,
    block_hash: row.block_hash,
    event_type: row.event_type as SplitDelegationArchivePayloadRow['event_type'],
    payload: JSON.stringify(payload),
    received_at: row.received_at,
  };
}

function build(payloads: SplitDelegationArchivePayloadRow[]) {
  const archive = {
    markDerived: vi.fn().mockResolvedValue(undefined),
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
  };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const delegationRepo = { insertBatch: vi.fn().mockResolvedValue(undefined) };
  const spaceResolver = { resolve: vi.fn().mockResolvedValue('dao-1') };
  const metrics = { processed: vi.fn() };
  const applier = new SplitDelegationProjectionApplier({
    archive: archive as never,
    dlq: dlq as never,
    payloads: { fetchPayloads: vi.fn().mockResolvedValue(payloads) } as never,
    delegationRepo: delegationRepo as never,
    spaceResolver: spaceResolver as never,
    metrics,
    network: '0x1',
  });
  return { applier, archive, dlq, delegationRepo, spaceResolver, metrics };
}

describe('SplitDelegationProjectionApplier', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives DelegationUpdated, resolving dao from context and fanning delegates', async () => {
    const row = baseRow();
    const { applier, delegationRepo, spaceResolver, archive } = build([
      payloadFor(row, {
        account: `0x${'11'.repeat(20)}`,
        context: 'lido-snapshot.eth',
        delegation: [{ delegate: D1, ratio: '1' }],
        expirationTimestamp: '0',
      }),
    ]);
    await applier.applyBatch([row]);
    expect(spaceResolver.resolve).toHaveBeenCalledWith('lido-snapshot.eth');
    expect(delegationRepo.insertBatch).toHaveBeenCalledOnce();
    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
  });

  it('no-op derives OptOutStatusSet (marks derived, inserts no rows)', async () => {
    const row = baseRow({ event_type: 'OptOutStatusSet' });
    const { applier, delegationRepo, archive } = build([
      payloadFor(row, {
        delegate: `0x${'22'.repeat(20)}`,
        context: 'lido-snapshot.eth',
        optout: true,
      }),
    ]);
    await applier.applyBatch([row]);
    expect(delegationRepo.insertBatch).toHaveBeenCalledWith([]);
    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
  });

  it('fails with unknown_event_type for an unexpected event', async () => {
    const row = baseRow({ event_type: 'VoteCast' });
    const { applier, metrics } = build([payloadFor(row, {})]);
    await applier.applyBatch([row]);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'unknown_event_type' }),
    );
  });

  it('fails with payload_missing when the archive payload is absent', async () => {
    const { applier, metrics } = build([]);
    await applier.applyBatch([baseRow()]);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'payload_missing' }),
    );
  });

  it('routes to DLQ at the attempt threshold', async () => {
    const { applier, dlq } = build([]);
    await applier.applyBatch([baseRow({ derivation_attempt_count: 4 })]);
    expect(dlq.insert).toHaveBeenCalledOnce();
  });
});
