import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { ProposalRepository, DelegationFlowProjectionWriter } from '@libs/db';
import { CompTokenDelegationProjectionApplier } from './comp-token-delegation-projection-applier';
import { ZERO_ADDRESS } from './delegation-projector';
import type { CompTokenArchivePayloadRow } from '../persistence/comp-token-archive-payload-repository';

const BASE_ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'compound_comp_token',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'DelegateChanged',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const DELEGATE_CHANGED_PAYLOAD: CompTokenArchivePayloadRow = {
  chain_id: '0x1',
  tx_hash: '0xtx',
  log_index: 1,
  block_hash: '0xblock',
  event_type: 'DelegateChanged',
  payload: JSON.stringify({
    delegator: `0x${'ab'.repeat(20)}`,
    fromDelegate: `0x${'cd'.repeat(20)}`,
    toDelegate: `0x${'ef'.repeat(20)}`,
  }),
  received_at: new Date('2026-01-01T00:00:00Z'),
};

interface MutableApplier {
  transaction: ReturnType<typeof vi.fn>;
}

function mutable(applier: CompTokenDelegationProjectionApplier): MutableApplier {
  return applier as unknown as MutableApplier;
}

function buildApplier(payloadsRows?: CompTokenArchivePayloadRow[]) {
  const archive = {
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    markDerived: vi.fn().mockResolvedValue(undefined),
  };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const payloads = {
    fetchPayloads: vi.fn().mockResolvedValue(payloadsRows ?? [DELEGATE_CHANGED_PAYLOAD]),
  };
  const metrics = { batchLookupSeconds: vi.fn(), chWriteSeconds: vi.fn(), processed: vi.fn() };

  const applier = new CompTokenDelegationProjectionApplier({
    pgDb: {} as never,
    chDb: {} as never,
    archive: archive as never,
    dlq: dlq as never,
    payloads: payloads as never,
    metrics,
  });

  return { applier, archive, dlq, payloads, metrics };
}

describe('CompTokenDelegationProjectionApplier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes DelegateChanged + DelegateVotesChanged event types', () => {
    const { applier } = buildApplier();
    expect(applier.eventTypes).toEqual(['DelegateChanged', 'DelegateVotesChanged']);
  });

  it('records projection_apply_error when proposal/db path is unavailable', async () => {
    const { applier, archive, metrics } = buildApplier();
    const repositories = {
      proposals: { findDaoIdForSource: vi.fn().mockResolvedValue('dao-1') },
      actors: {
        findByAddress: vi
          .fn()
          .mockResolvedValueOnce({ id: 'delegator-actor' })
          .mockResolvedValueOnce({ id: 'delegate-actor' }),
      },
      delegations: { insert: vi.fn().mockResolvedValue(undefined) },
      archive: { markDerived: vi.fn().mockResolvedValue(undefined) },
    };
    mutable(applier).transaction = vi.fn(
      async (fn: (repos: typeof repositories) => Promise<void>) => fn(repositories),
    );

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });

  it('fails with projection_apply_error', async () => {
    const { applier, archive, metrics } = buildApplier();
    const repositories = {
      proposals: { findDaoIdForSource: vi.fn().mockResolvedValue('dao-1') },
      actors: { findByAddress: vi.fn().mockResolvedValue(undefined) },
      delegations: { insert: vi.fn() },
      archive: { markDerived: vi.fn() },
    };
    mutable(applier).transaction = vi.fn(
      async (fn: (repos: typeof repositories) => Promise<void>) => fn(repositories),
    );

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });

  it('routes to delegation_projection_stage when threshold is reached', async () => {
    const { applier, dlq } = buildApplier();
    const repositories = {
      proposals: { findDaoIdForSource: vi.fn().mockResolvedValue('dao-1') },
      actors: { findByAddress: vi.fn().mockResolvedValue(undefined) },
      delegations: { insert: vi.fn() },
      archive: { markDerived: vi.fn() },
    };
    mutable(applier).transaction = vi.fn(
      async (fn: (repos: typeof repositories) => Promise<void>) => fn(repositories),
    );

    await applier.applyBatch([{ ...BASE_ROW, derivation_attempt_count: 4 }]);

    expect(dlq.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'delegation_projection_stage' }),
    );
  });

  it('derives DelegateChanged row (toDelegate → lowercase)', async () => {
    const { applier, metrics } = buildApplier();

    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(DelegationFlowProjectionWriter.prototype, 'insertBatch').mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(DelegationFlowProjectionWriter.prototype.insertBatch).toHaveBeenCalledTimes(1);
    const rows = (DelegationFlowProjectionWriter.prototype.insertBatch as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as { event_type: string; delegate_address: string }[];
    expect(rows[0]?.event_type).toBe('delegate_changed');
    expect(rows[0]?.delegate_address).toBe(`0x${'ef'.repeat(20)}`);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('maps ZERO_ADDRESS toDelegate to ZERO_DELEGATE_ADDRESS', async () => {
    const zeroPayload: CompTokenArchivePayloadRow = {
      ...DELEGATE_CHANGED_PAYLOAD,
      payload: JSON.stringify({
        delegator: `0x${'ab'.repeat(20)}`,
        fromDelegate: `0x${'cd'.repeat(20)}`,
        toDelegate: ZERO_ADDRESS,
      }),
    };
    const { applier } = buildApplier([zeroPayload]);

    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(DelegationFlowProjectionWriter.prototype, 'insertBatch').mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    const rows = (DelegationFlowProjectionWriter.prototype.insertBatch as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as { delegate_address: string }[];
    // ZERO_ADDRESS toDelegate is stored as ZERO_DELEGATE_ADDRESS (same value, different semantic)
    expect(rows[0]?.delegate_address).toBe(ZERO_ADDRESS);
  });

  it('derives DelegateVotesChanged row', async () => {
    const dvPayload: CompTokenArchivePayloadRow = {
      ...DELEGATE_CHANGED_PAYLOAD,
      event_type: 'DelegateVotesChanged',
      payload: JSON.stringify({
        delegate: `0x${'ab'.repeat(20)}`,
        previousVotes: '100',
        newVotes: '200',
      }),
    };
    const { applier, metrics } = buildApplier([dvPayload]);
    const dvRow: ArchiveDerivationRow = { ...BASE_ROW, event_type: 'DelegateVotesChanged' };

    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(DelegationFlowProjectionWriter.prototype, 'insertBatch').mockResolvedValue(undefined);

    await applier.applyBatch([dvRow]);

    const rows = (DelegationFlowProjectionWriter.prototype.insertBatch as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as { event_type: string; voting_power: string }[];
    expect(rows[0]?.event_type).toBe('votes_changed');
    expect(rows[0]?.voting_power).toBe('200');
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

  it('fails with decode_error when payload is not valid JSON', async () => {
    const badPayload: CompTokenArchivePayloadRow = {
      ...DELEGATE_CHANGED_PAYLOAD,
      payload: '!!bad',
    };
    const { applier, archive, metrics } = buildApplier([badPayload]);

    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'decode_error' }),
    );
  });

  it('fails with payload_missing when payload is absent from fetched batch', async () => {
    const { applier, archive, metrics } = buildApplier([]);

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith(BASE_ROW.id);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'payload_missing' }),
    );
  });

  it('fails with watermark_update_error when archive.markDerived throws', async () => {
    const { applier, archive, metrics } = buildApplier();

    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(DelegationFlowProjectionWriter.prototype, 'insertBatch').mockResolvedValue(undefined);
    (archive.markDerived as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PG failure'));

    await applier.applyBatch([BASE_ROW]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'watermark_update_error' }),
    );
  });
});
