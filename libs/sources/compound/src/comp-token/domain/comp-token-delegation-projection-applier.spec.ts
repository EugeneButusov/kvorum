import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { CompTokenDelegationProjectionApplier } from './comp-token-delegation-projection-applier';
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
  const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
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

  it('caps payload fetch batch at 50', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      ...BASE_ROW,
      id: `archive-${index}`,
      log_index: index,
      tx_hash: `0xtx${index}`,
    }));
    const payloadsRows = rows.map((row) => ({
      ...DELEGATE_CHANGED_PAYLOAD,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
    }));
    const built = buildApplier(payloadsRows);
    mutable(built.applier).transaction = vi.fn().mockResolvedValue(undefined);

    await built.applier.applyBatch(rows);
    expect(built.payloads.fetchPayloads.mock.calls[0]?.[0]).toHaveLength(50);
  });
});
