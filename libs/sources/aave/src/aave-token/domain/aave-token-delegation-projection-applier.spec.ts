import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { DelegationFlowProjectionWriter, ProposalRepository } from '@libs/db';
import { AaveTokenDelegationProjectionApplier } from './aave-token-delegation-projection-applier';
import { ZERO_ADDRESS } from './delegation-projector';
import type { AaveTokenArchivePayloadRow } from '../persistence/archive-payload-repository';

const BASE_ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_token',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'DelegateChanged',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

function votingPayload(overrides: Record<string, unknown> = {}): AaveTokenArchivePayloadRow {
  return {
    chain_id: '0x1',
    tx_hash: '0xtx',
    log_index: 1,
    block_hash: '0xblock',
    event_type: 'DelegateChanged',
    payload: JSON.stringify({
      delegator: `0x${'ab'.repeat(20)}`,
      delegatee: `0x${'ef'.repeat(20)}`,
      delegationType: 0,
      ...overrides,
    }),
    received_at: new Date('2026-01-01T00:00:00Z'),
  };
}

function buildApplier(payloadsRows?: AaveTokenArchivePayloadRow[]) {
  const archive = {
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    markDerived: vi.fn().mockResolvedValue(undefined),
  };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const payloads = {
    fetchPayloads: vi.fn().mockResolvedValue(payloadsRows ?? [votingPayload()]),
  };
  const metrics = { batchLookupSeconds: vi.fn(), chWriteSeconds: vi.fn(), processed: vi.fn() };

  const applier = new AaveTokenDelegationProjectionApplier({
    pgDb: {} as never,
    chDb: {} as never,
    archive: archive as never,
    dlq: dlq as never,
    payloads: payloads as never,
    metrics,
  });

  return { applier, archive, dlq, payloads, metrics };
}

function lastInsertedRows() {
  return (DelegationFlowProjectionWriter.prototype.insertBatch as ReturnType<typeof vi.fn>).mock
    .calls[0]?.[0] as Array<{ event_type: string; delegate_address: string; voting_power: string }>;
}

describe('AaveTokenDelegationProjectionApplier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the aave_token / DelegateChanged dispatch contract', () => {
    const { applier } = buildApplier();
    expect(applier.kind).toBe('projection');
    expect(applier.sourceTypes).toEqual(['aave_token']);
    expect(applier.eventTypes).toEqual(['DelegateChanged']);
  });

  it('derives a VOTING DelegateChanged into a delegate_changed row (voting_power 0)', async () => {
    const { applier, metrics } = buildApplier();
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(DelegationFlowProjectionWriter.prototype, 'insertBatch').mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    const rows = lastInsertedRows();
    expect(rows[0]?.event_type).toBe('delegate_changed');
    expect(rows[0]?.delegate_address).toBe(`0x${'ef'.repeat(20)}`);
    expect(rows[0]?.voting_power).toBe('0');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('maps an address(0) delegatee to the zero-delegate sentinel', async () => {
    const { applier } = buildApplier([votingPayload({ delegatee: ZERO_ADDRESS })]);
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(DelegationFlowProjectionWriter.prototype, 'insertBatch').mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(lastInsertedRows()[0]?.delegate_address).toBe(ZERO_ADDRESS);
  });

  it('no-op derives a PROPOSITION DelegateChanged (no projection row, marked derived)', async () => {
    const { applier, archive, metrics } = buildApplier([votingPayload({ delegationType: 1 })]);
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    const insert = vi
      .spyOn(DelegationFlowProjectionWriter.prototype, 'insertBatch')
      .mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(insert).toHaveBeenCalledWith([]);
    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('fails with no_dao when findDaoIdForSource returns undefined', async () => {
    const { applier, archive, metrics } = buildApplier();
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'no_dao' }),
    );
  });

  it('fails with decode_error when the payload is not valid JSON', async () => {
    const { applier, archive, metrics } = buildApplier([{ ...votingPayload(), payload: '!!bad' }]);
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'decode_error' }),
    );
  });

  it('fails with payload_missing when the archive payload is absent', async () => {
    const { applier, archive, metrics } = buildApplier([]);

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'payload_missing' }),
    );
  });

  it('fails with watermark_update_error when markDerived throws', async () => {
    const { applier, archive, metrics } = buildApplier();
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(DelegationFlowProjectionWriter.prototype, 'insertBatch').mockResolvedValue(undefined);
    (archive.markDerived as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PG failure'));

    await applier.applyBatch([BASE_ROW]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'watermark_update_error' }),
    );
  });

  it('routes to delegation_projection_stage once the DLQ threshold is reached', async () => {
    const { applier, dlq } = buildApplier();
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue(undefined);

    await applier.applyBatch([{ ...BASE_ROW, derivation_attempt_count: 4 }]);

    expect(dlq.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'delegation_projection_stage' }),
    );
  });

  it('skips work for an empty batch', async () => {
    const { applier, payloads } = buildApplier();
    await applier.applyBatch([]);
    expect(payloads.fetchPayloads).not.toHaveBeenCalled();
  });
});
