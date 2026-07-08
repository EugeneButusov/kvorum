import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { ArchiveDerivationRow } from '@libs/db';
import {
  DualGovernanceProposalProjectionApplier,
  type DualGovernanceProposalProjectionApplierDeps,
} from './dg-proposal-projection-applier';

const CHAIN_ID = '0x1';
const TX = '0x' + 'cd'.repeat(32);
const BLOCK_HASH = '0x' + 'ab'.repeat(32);
const EXECUTOR = '0x23E0B465633FF5178808F4A75186E2F2F9537021';
const CALLS = [{ target: '0x' + '11'.repeat(20), value: '0', payload: '0xdeadbeef' }];

function makeRow(overrides: Partial<ArchiveDerivationRow> = {}): ArchiveDerivationRow {
  return {
    id: 'row-x',
    dao_source_id: 'src-1',
    source_type: 'dual_governance',
    chain_id: CHAIN_ID,
    block_number: '23095715',
    block_hash: BLOCK_HASH,
    tx_hash: TX,
    log_index: 0,
    event_type: 'ProposalSubmitted',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
    ...overrides,
  } as ArchiveDerivationRow;
}

function payloadRowFor(row: ArchiveDerivationRow, payload: string) {
  return {
    chain_id: row.chain_id,
    tx_hash: row.tx_hash,
    log_index: row.log_index,
    block_hash: row.block_hash,
    event_type: row.event_type,
    payload,
    received_at: row.received_at,
  };
}

const SUBMITTED = JSON.stringify({ id: '7', executor: EXECUTOR, calls: CALLS });
const SCHEDULED = JSON.stringify({ id: '7' });
const EXECUTED = JSON.stringify({ id: '7' });
const CANCELLED_TILL = JSON.stringify({ proposalId: '7' });
const META = JSON.stringify({
  proposerAccount: '0x' + '99'.repeat(20),
  proposalId: '7',
  metadata: '# Direct upgrade',
});

function ledgerRow(status: string, proposalId = 'prop-1') {
  return {
    id: 'dgp-1',
    dao_id: 'dao-1',
    dg_proposal_id: '7',
    proposal_id: proposalId,
    origin: 'aragon',
    aragon_source_id: '201',
    executor: EXECUTOR.toLowerCase(),
    calls_hash: '0xhash',
    submitted_tx_hash: TX,
    submitted_block: '23095715',
    submitted_at: new Date('2026-01-01T00:00:00Z'),
    status,
    scheduled_at: null,
    executed_at: null,
    cancelled_at: null,
    last_reconcile_check_block: null,
  };
}

function makeDeps(over: {
  row?: ArchiveDerivationRow;
  payload?: string;
  daoId?: string;
  voteId?: string;
  maxBlock?: bigint;
  aragonProposal?: { id: string } | undefined;
  metaRows?: { payload: string }[];
  insertProposalResult?: { inserted: boolean; proposalId?: string };
  directExisting?: { id: string } | undefined;
  upsert?: { inserted: boolean; row: ReturnType<typeof ledgerRow> };
  scheduledRow?: ReturnType<typeof ledgerRow> | undefined;
  executedRow?: ReturnType<typeof ledgerRow> | undefined;
  cancelled?: ReturnType<typeof ledgerRow>[];
  rageQuitAts?: Date[];
}) {
  const row = over.row ?? makeRow();
  const archive = {
    markDerived: vi.fn().mockResolvedValue(undefined),
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
  };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const proposals = {
    findDaoIdForSource: vi.fn().mockResolvedValue(over.daoId ?? 'dao-1'),
    findBySource: vi
      .fn()
      .mockResolvedValueOnce(
        over.aragonProposal !== undefined ? over.aragonProposal : over.directExisting,
      )
      .mockResolvedValue(over.directExisting),
    insertProposal: vi
      .fn()
      .mockResolvedValue(over.insertProposalResult ?? { inserted: true, proposalId: 'direct-1' }),
    insertActions: vi.fn().mockResolvedValue(1),
    setStateFromDerivation: vi.fn().mockResolvedValue(undefined),
  };
  const actors = {
    findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-9' }),
  };
  const ledger = {
    upsertSubmission: vi
      .fn()
      .mockResolvedValue(over.upsert ?? { inserted: true, row: ledgerRow('submitted') }),
    markScheduled: vi.fn().mockResolvedValue(over.scheduledRow),
    markExecuted: vi.fn().mockResolvedValue(over.executedRow),
    cancelThrough: vi.fn().mockResolvedValue(over.cancelled ?? []),
    findByDgId: vi.fn().mockResolvedValue(undefined),
  };
  const enactment = {
    findEnactmentVoteId: vi.fn().mockResolvedValue(over.voteId),
    maxArchivedBlock: vi.fn().mockResolvedValue(over.maxBlock ?? 99_999_999n),
  };
  // Default: no rage-quits, so the resolver yields plain f(ledger status).
  const history = {
    rageQuitTransitionsForDao: vi.fn().mockResolvedValue(over.rageQuitAts ?? []),
  };
  const metrics = { batchLookupSeconds: vi.fn(), processed: vi.fn() };
  const deps: DualGovernanceProposalProjectionApplierDeps = {
    archive: archive as never,
    dlq: dlq as never,
    payloads: {
      fetchPayloads: vi
        .fn()
        .mockResolvedValue(over.payload === undefined ? [] : [payloadRowFor(row, over.payload)]),
      findEventsInTx: vi.fn().mockResolvedValue(over.metaRows ?? []),
    } as never,
    proposals: proposals as never,
    actors: actors as never,
    ledger: ledger as never,
    enactment: enactment as never,
    history: history as never,
    metrics,
    logger: silentLogger,
  };
  return { deps, row, archive, proposals, actors, ledger, enactment, history, metrics };
}

describe('DualGovernanceProposalProjectionApplier', () => {
  it('declares the projection contract for the DG proposal-flow events', () => {
    const { deps } = makeDeps({ payload: SUBMITTED });
    const applier = new DualGovernanceProposalProjectionApplier(deps);
    expect(applier.kind).toBe('projection');
    expect(applier.sourceTypes).toEqual(['dual_governance']);
    expect(applier.eventTypes).toEqual([
      'ProposalSubmitted',
      'ProposalScheduled',
      'ProposalExecuted',
      'ProposalsCancelledTill',
      'ProposalSubmittedMeta',
    ]);
  });

  it('is a no-op on an empty batch', async () => {
    const { deps, ledger } = makeDeps({ payload: SUBMITTED });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([]);
    expect(ledger.upsertSubmission).not.toHaveBeenCalled();
  });

  it('correlates a submission to its Aragon vote and reclassifies executed→queued (case 1)', async () => {
    const { deps, ledger, proposals, archive } = makeDeps({
      payload: SUBMITTED,
      voteId: '201',
      aragonProposal: { id: 'aragon-prop-1' },
      upsert: { inserted: true, row: ledgerRow('submitted', 'aragon-prop-1') },
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(ledger.upsertSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'aragon',
        proposal_id: 'aragon-prop-1',
        aragon_source_id: '201',
        dg_proposal_id: '7',
        status: 'submitted',
      }),
    );
    expect(proposals.insertActions).toHaveBeenCalledWith('aragon-prop-1', expect.any(Array), 1);
    expect(proposals.setStateFromDerivation).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'aragon-prop-1', state: 'queued' }),
    );
    expect(proposals.insertProposal).not.toHaveBeenCalled();
    expect(archive.markDerived).toHaveBeenCalledWith('row-x');
  });

  it('stays idempotent when the ledger row already existed (resubmission/replay, case 5)', async () => {
    const { deps, proposals, archive } = makeDeps({
      payload: SUBMITTED,
      voteId: '201',
      aragonProposal: { id: 'aragon-prop-1' },
      upsert: { inserted: false, row: ledgerRow('submitted', 'aragon-prop-1') },
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(proposals.setStateFromDerivation).toHaveBeenCalled();
    expect(archive.markDerived).toHaveBeenCalledWith('row-x');
  });

  it('creates its own proposal for a direct submission (case 3)', async () => {
    const { deps, proposals, actors, ledger, archive } = makeDeps({
      payload: SUBMITTED,
      voteId: undefined,
      metaRows: [{ payload: META }],
      insertProposalResult: { inserted: true, proposalId: 'direct-1' },
      upsert: { inserted: true, row: ledgerRow('submitted', 'direct-1') },
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(actors.findOrCreateActorAddress).toHaveBeenCalledWith(
      '0x' + '99'.repeat(20),
      'proposer_event',
    );
    expect(proposals.insertProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'dual_governance',
        source_id: '7',
        proposer_actor_id: 'actor-9',
        binding: true,
      }),
    );
    expect(ledger.upsertSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'direct',
        proposal_id: 'direct-1',
        aragon_source_id: null,
      }),
    );
    expect(archive.markDerived).toHaveBeenCalledWith('row-x');
  });

  it('falls back to findBySource when the direct proposal already existed', async () => {
    const { deps, ledger } = makeDeps({
      payload: SUBMITTED,
      voteId: undefined,
      metaRows: [{ payload: META }],
      insertProposalResult: { inserted: false },
      directExisting: { id: 'direct-existing' },
      upsert: { inserted: true, row: ledgerRow('submitted', 'direct-existing') },
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(ledger.upsertSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'direct', proposal_id: 'direct-existing' }),
    );
  });

  it('retries a direct submission with missing co-tx meta while below the skip threshold', async () => {
    const { deps, archive, metrics } = makeDeps({
      payload: SUBMITTED,
      voteId: undefined,
      metaRows: [], // no ProposalSubmittedMeta in the tx
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ derivation_attempt_count: 0 }),
    ]);
    expect(archive.markDerived).not.toHaveBeenCalled();
    expect(archive.incrementAttemptCount).toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'meta_missing' }),
    );
  });

  it('skips a direct submission whose co-tx meta stays absent past the skip threshold', async () => {
    const { deps, archive, ledger, metrics } = makeDeps({
      payload: SUBMITTED,
      voteId: undefined,
      metaRows: [], // co-tx meta permanently absent
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ derivation_attempt_count: 3 }), // >= META_MISSING_SKIP_ATTEMPTS
    ]);
    // skipped, not failed: leaves the derivation queue, no proposal minted, no DLQ inflation.
    expect(archive.markDerived).toHaveBeenCalledWith('row-x');
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
    expect(ledger.upsertSubmission).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'skipped' }));
  });

  it('defers a submission until the Aragon archive covers its block (no DLQ, no markDerived)', async () => {
    const { deps, ledger, archive, metrics } = makeDeps({
      payload: SUBMITTED,
      maxBlock: 1n, // archive far behind the DG block
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(ledger.upsertSubmission).not.toHaveBeenCalled();
    expect(archive.markDerived).not.toHaveBeenCalled();
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'deferred', reason: null }),
    );
  });

  it('defers a correlated submission whose Aragon proposal has not derived yet', async () => {
    const { deps, ledger, archive } = makeDeps({
      payload: SUBMITTED,
      voteId: '201',
      aragonProposal: undefined,
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(ledger.upsertSubmission).not.toHaveBeenCalled();
    expect(archive.markDerived).not.toHaveBeenCalled();
  });

  it('advances the unified state on ProposalScheduled', async () => {
    const { deps, ledger, proposals, archive } = makeDeps({
      row: makeRow({ event_type: 'ProposalScheduled' }),
      payload: SCHEDULED,
      scheduledRow: ledgerRow('scheduled', 'aragon-prop-1'),
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ event_type: 'ProposalScheduled' }),
    ]);
    expect(ledger.markScheduled).toHaveBeenCalledWith('dao-1', '7', expect.any(Date));
    expect(proposals.setStateFromDerivation).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'aragon-prop-1', state: 'queued' }),
    );
    expect(archive.markDerived).toHaveBeenCalled();
  });

  it('defers a scheduled/executed event whose submission has not derived yet', async () => {
    const { deps, archive } = makeDeps({
      row: makeRow({ event_type: 'ProposalScheduled' }),
      payload: SCHEDULED,
      scheduledRow: undefined,
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ event_type: 'ProposalScheduled' }),
    ]);
    expect(archive.markDerived).not.toHaveBeenCalled();
  });

  it('advances the unified state to executed on ProposalExecuted', async () => {
    const { deps, proposals } = makeDeps({
      row: makeRow({ event_type: 'ProposalExecuted' }),
      payload: EXECUTED,
      executedRow: ledgerRow('executed', 'aragon-prop-1'),
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ event_type: 'ProposalExecuted' }),
    ]);
    expect(proposals.setStateFromDerivation).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'aragon-prop-1', state: 'executed' }),
    );
  });

  it('cancels the range and marks each affected proposal canceled on ProposalsCancelledTill', async () => {
    const { deps, ledger, proposals } = makeDeps({
      row: makeRow({ event_type: 'ProposalsCancelledTill' }),
      payload: CANCELLED_TILL,
      cancelled: [ledgerRow('cancelled', 'p-a'), ledgerRow('cancelled', 'p-b')],
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ event_type: 'ProposalsCancelledTill' }),
    ]);
    expect(ledger.cancelThrough).toHaveBeenCalledWith('dao-1', '7', expect.any(Date));
    expect(proposals.setStateFromDerivation).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'p-a', state: 'canceled' }),
    );
    expect(proposals.setStateFromDerivation).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'p-b', state: 'canceled' }),
    );
  });

  it('resolves a bulk-cancel inside a rage-quit window to vetoed, not canceled (ADR-031)', async () => {
    const { deps, proposals } = makeDeps({
      row: makeRow({ event_type: 'ProposalsCancelledTill' }),
      payload: CANCELLED_TILL,
      cancelled: [ledgerRow('cancelled', 'p-a')],
      // A rage-quit after the ledger row's submitted_at (2026-01-01) covers its pending window.
      rageQuitAts: [new Date('2026-02-01T00:00:00Z')],
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ event_type: 'ProposalsCancelledTill' }),
    ]);
    expect(proposals.setStateFromDerivation).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'p-a', state: 'vetoed' }),
    );
  });

  it('defers a bulk-cancel until the Aragon archive covers its block', async () => {
    const { deps, ledger, archive } = makeDeps({
      row: makeRow({ event_type: 'ProposalsCancelledTill' }),
      payload: CANCELLED_TILL,
      maxBlock: 1n,
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ event_type: 'ProposalsCancelledTill' }),
    ]);
    expect(ledger.cancelThrough).not.toHaveBeenCalled();
    expect(archive.markDerived).not.toHaveBeenCalled();
  });

  it('drains ProposalSubmittedMeta to derived without further writes', async () => {
    const { deps, ledger, proposals, archive } = makeDeps({
      row: makeRow({ event_type: 'ProposalSubmittedMeta' }),
      payload: META,
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ event_type: 'ProposalSubmittedMeta' }),
    ]);
    expect(ledger.upsertSubmission).not.toHaveBeenCalled();
    expect(proposals.setStateFromDerivation).not.toHaveBeenCalled();
    expect(archive.markDerived).toHaveBeenCalledWith('row-x');
  });

  it('routes to the failure path when the payload is missing', async () => {
    const { deps, archive } = makeDeps({ payload: undefined });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('row-x');
    expect(archive.markDerived).not.toHaveBeenCalled();
  });

  it('routes to the failure path on a malformed payload', async () => {
    const { deps, archive } = makeDeps({ payload: '{not json' });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('row-x');
  });

  it('routes to the failure path on an unknown dao_source', async () => {
    const { deps, archive } = makeDeps({ payload: SUBMITTED, daoId: undefined as never });
    // daoId undefined → requireDaoId throws unknown_dao_source
    deps.proposals.findDaoIdForSource = vi.fn().mockResolvedValue(undefined) as never;
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('row-x');
  });

  it('routes to the failure path when an event type outside the flow set is dispatched', async () => {
    const { deps, archive } = makeDeps({
      row: makeRow({ event_type: 'DualGovernanceStateChanged' }),
      payload: '{}',
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([
      makeRow({ event_type: 'DualGovernanceStateChanged' }),
    ]);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('row-x');
    expect(archive.markDerived).not.toHaveBeenCalled();
  });

  it('routes to the failure path when a direct submission has no co-tx Meta', async () => {
    const { deps, archive } = makeDeps({
      payload: SUBMITTED,
      voteId: undefined,
      metaRows: [],
    });
    await new DualGovernanceProposalProjectionApplier(deps).applyBatch([makeRow()]);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('row-x');
    expect(archive.markDerived).not.toHaveBeenCalled();
  });
});
