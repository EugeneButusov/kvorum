import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { DelegateRegistryDelegationProjectionApplier } from './delegation-projection-applier';
import { encodeSpaceId } from '../../delegation/address';
import type { DelegateRegistryArchivePayloadRow } from '../persistence/archive-payload-repository';

const SPACE_ID = encodeSpaceId('lido-snapshot.eth');
const ZERO_SPACE = `0x${'00'.repeat(32)}`;

function baseRow(overrides: Partial<ArchiveDerivationRow> = {}): ArchiveDerivationRow {
  return {
    id: 'archive-1',
    source_type: 'snapshot_delegate_registry',
    dao_source_id: 'src-1',
    chain_id: '0x1',
    block_number: '100',
    block_hash: '0xblock',
    tx_hash: '0xtx',
    log_index: 1,
    event_type: 'SetDelegate',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
    ...overrides,
  };
}

function payloadFor(row: ArchiveDerivationRow, id: string): DelegateRegistryArchivePayloadRow {
  return {
    chain_id: row.chain_id,
    tx_hash: row.tx_hash,
    log_index: row.log_index,
    block_hash: row.block_hash,
    event_type: row.event_type as 'SetDelegate' | 'ClearDelegate',
    payload: JSON.stringify({
      delegator: `0x${'11'.repeat(20)}`,
      id,
      delegate: `0x${'22'.repeat(20)}`,
    }),
    received_at: row.received_at,
  };
}

function build(payloads: DelegateRegistryArchivePayloadRow[], daoId: string | null = 'dao-1') {
  const archive = {
    markDerived: vi.fn().mockResolvedValue(undefined),
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
  };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const delegationRepo = { insertBatch: vi.fn().mockResolvedValue(undefined) };
  const spaceResolver = { resolve: vi.fn().mockResolvedValue(daoId) };
  const metrics = { processed: vi.fn() };
  const applier = new DelegateRegistryDelegationProjectionApplier({
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

describe('DelegateRegistryDelegationProjectionApplier', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives a space-specific SetDelegate, resolving the dao from the decoded space', async () => {
    const row = baseRow();
    const { applier, archive, delegationRepo, spaceResolver, metrics } = build([
      payloadFor(row, SPACE_ID),
    ]);
    await applier.applyBatch([row]);

    expect(spaceResolver.resolve).toHaveBeenCalledWith('lido-snapshot.eth');
    expect(delegationRepo.insertBatch).toHaveBeenCalledOnce();
    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('stores a global delegation (id == 0x0) with no space resolution', async () => {
    const row = baseRow();
    const { applier, delegationRepo, spaceResolver } = build([payloadFor(row, ZERO_SPACE)]);
    await applier.applyBatch([row]);

    expect(spaceResolver.resolve).not.toHaveBeenCalled();
    const inserted = delegationRepo.insertBatch.mock.calls[0]?.[0];
    expect(inserted?.[0]).toMatchObject({ dao_id: null, space_id: null });
  });

  it('fails with payload_missing when no archive payload is found', async () => {
    const row = baseRow();
    const { applier, archive, metrics } = build([]);
    await applier.applyBatch([row]);
    expect(archive.markDerived).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'payload_missing' }),
    );
  });

  it('fails with decode_error on unparseable payload JSON', async () => {
    const row = baseRow();
    const bad = { ...payloadFor(row, SPACE_ID), payload: '{not json' };
    const { applier, metrics } = build([bad]);
    await applier.applyBatch([row]);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'decode_error' }),
    );
  });

  it('routes to DLQ once the attempt count reaches the threshold', async () => {
    const row = baseRow({ derivation_attempt_count: 4 });
    const { applier, dlq } = build([]);
    await applier.applyBatch([row]);
    expect(dlq.insert).toHaveBeenCalledOnce();
  });

  it('reports watermark_update_error when markDerived throws', async () => {
    const row = baseRow();
    const { applier, archive, metrics } = build([payloadFor(row, SPACE_ID)]);
    archive.markDerived.mockRejectedValueOnce(new Error('pg down'));
    await applier.applyBatch([row]);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'watermark_update_error' }),
    );
  });

  it('no-ops on an empty batch', async () => {
    const { applier, delegationRepo } = build([]);
    await applier.applyBatch([]);
    expect(delegationRepo.insertBatch).not.toHaveBeenCalled();
  });
});
