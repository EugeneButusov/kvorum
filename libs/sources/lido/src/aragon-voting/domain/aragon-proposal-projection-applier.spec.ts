import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AragonProposalProjectionApplier } from './aragon-proposal-projection-applier';
import type { AragonVotingArchivePayloadRow } from '../persistence/archive-payload-repository';

const APP_ADDRESS = '0x' + '2e'.repeat(20);
const CREATOR = '0x' + '11'.repeat(20);

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
    event_type: 'StartVote',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
    ...overrides,
  } as ArchiveDerivationRow;
}

function makePayload(payload: unknown, eventType = 'StartVote'): AragonVotingArchivePayloadRow {
  return {
    chain_id: '0x1',
    tx_hash: '0xtx',
    log_index: 1,
    block_hash: '0xblock',
    event_type: eventType,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    received_at: new Date('2026-01-01T00:00:00Z'),
  };
}

interface MutableApplier {
  transaction: ReturnType<typeof vi.fn>;
}
function mutable(a: AragonProposalProjectionApplier): MutableApplier {
  return a as unknown as MutableApplier;
}

function buildApplier(opts?: { payloads?: AragonVotingArchivePayloadRow[] }) {
  const archive = {
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    markDerived: vi.fn().mockResolvedValue(undefined),
  };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const payloads = {
    fetchPayloads: vi
      .fn()
      .mockResolvedValue(
        opts?.payloads ?? [makePayload({ voteId: '1', creator: CREATOR, metadata: 'm' })],
      ),
  };
  const metrics = { batchLookupSeconds: vi.fn(), processed: vi.fn() };
  const applier = new AragonProposalProjectionApplier({
    pgDb: {} as never,
    archive: archive as never,
    dlq: dlq as never,
    payloads: payloads as never,
    metrics,
  });
  const repos = {
    actors: { findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }) },
    proposals: {
      findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
      insertProposal: vi.fn().mockResolvedValue({ inserted: true, proposalId: 'p-1' }),
      ensureChoices: vi.fn().mockResolvedValue(undefined),
      advanceState: vi.fn().mockResolvedValue(1),
      findBySource: vi.fn().mockResolvedValue({ id: 'p-1' }),
    },
    aragonProposals: {
      findVotingAddress: vi.fn().mockResolvedValue(APP_ADDRESS),
      insertMetadata: vi.fn().mockResolvedValue(undefined),
      setExecutedAt: vi.fn().mockResolvedValue(undefined),
    },
    archive: { markDerived: vi.fn().mockResolvedValue(undefined) },
    actorResolution: { markActorResolved: vi.fn().mockResolvedValue(undefined) },
  };
  mutable(applier).transaction = vi.fn((fn: (r: typeof repos) => Promise<void>) => fn(repos));
  return { applier, archive, dlq, payloads, metrics, repos };
}

describe('AragonProposalProjectionApplier', () => {
  it('declares the proposal-lifecycle + config contract', () => {
    const { applier } = buildApplier();
    expect(applier.kind).toBe('projection');
    expect([...applier.sourceTypes]).toEqual(['aragon_voting']);
    expect([...applier.eventTypes]).toEqual([
      'StartVote',
      'ExecuteVote',
      'ChangeSupportRequired',
      'ChangeMinQuorum',
      'ChangeVoteTime',
      'ChangeObjectionPhaseTime',
    ]);
  });

  it('returns early on an empty batch', async () => {
    const { applier, payloads } = buildApplier();
    await applier.applyBatch([]);
    expect(payloads.fetchPayloads).not.toHaveBeenCalled();
  });

  it('derives StartVote → proposal + metadata seed + choices', async () => {
    const { applier, metrics, repos } = buildApplier();
    await applier.applyBatch([makeRow({ event_type: 'StartVote' })]);

    expect(repos.actors.findOrCreateActorAddress).toHaveBeenCalledWith(CREATOR, 'proposer_event');
    expect(repos.proposals.insertProposal).toHaveBeenCalled();
    expect(repos.aragonProposals.insertMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ proposal_id: 'p-1', app_address: APP_ADDRESS }),
    );
    expect(repos.proposals.ensureChoices).toHaveBeenCalled();
    expect(repos.archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(repos.actorResolution.markActorResolved).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'derived' }));
  });

  it('skips an idempotent StartVote re-derivation (no metadata insert)', async () => {
    const { applier, metrics, repos } = buildApplier();
    repos.proposals.insertProposal.mockResolvedValue({ inserted: false });
    await applier.applyBatch([makeRow({ event_type: 'StartVote' })]);

    expect(repos.aragonProposals.insertMetadata).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_idempotent' }),
    );
  });

  it('throws (→ projection_apply_error) when voting_address is missing from config', async () => {
    const { applier, archive, metrics, repos } = buildApplier();
    repos.aragonProposals.findVotingAddress.mockResolvedValue(undefined);
    await applier.applyBatch([makeRow({ event_type: 'StartVote' })]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });

  it('advances ExecuteVote to executed and stamps executed_at', async () => {
    const { applier, metrics, repos } = buildApplier({
      payloads: [makePayload({ voteId: '1' }, 'ExecuteVote')],
    });
    await applier.applyBatch([makeRow({ event_type: 'ExecuteVote' })]);

    expect(repos.proposals.advanceState).toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'executed' }),
    );
    expect(repos.aragonProposals.setExecutedAt).toHaveBeenCalledWith('p-1', expect.any(Date));
    expect(metrics.processed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'derived' }));
  });

  it('records skipped_state_guard when ExecuteVote advances nothing', async () => {
    const { applier, metrics, repos } = buildApplier({
      payloads: [makePayload({ voteId: '1' }, 'ExecuteVote')],
    });
    repos.proposals.advanceState.mockResolvedValue(0);
    await applier.applyBatch([makeRow({ event_type: 'ExecuteVote' })]);

    expect(repos.aragonProposals.setExecutedAt).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_state_guard' }),
    );
  });

  it('drains a Change* config event as a no-op (marks derived + actor-resolved)', async () => {
    const { applier, metrics, repos } = buildApplier({
      payloads: [makePayload({ voteTime: '259200' }, 'ChangeVoteTime')],
    });
    await applier.applyBatch([makeRow({ event_type: 'ChangeVoteTime' })]);

    expect(repos.proposals.insertProposal).not.toHaveBeenCalled();
    expect(repos.archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(repos.actorResolution.markActorResolved).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_config' }),
    );
  });

  it('fails with payload_missing when the CH payload is absent', async () => {
    const { applier, archive, metrics } = buildApplier({ payloads: [] });
    await applier.applyBatch([makeRow({ event_type: 'StartVote' })]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'payload_missing' }),
    );
  });

  it('fails with decode_error on malformed payload JSON', async () => {
    const { applier, metrics } = buildApplier({
      payloads: [makePayload('{not json', 'StartVote')],
    });
    await applier.applyBatch([makeRow({ event_type: 'StartVote' })]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'decode_error' }),
    );
  });

  it('routes to proposal_projection_stage DLQ at the attempt threshold', async () => {
    const { applier, dlq } = buildApplier({ payloads: [] });
    await applier.applyBatch([makeRow({ event_type: 'StartVote', derivation_attempt_count: 4 })]);

    expect(dlq.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'proposal_projection_stage' }),
    );
  });

  it('throws (→ projection_apply_error) for an unknown dao_source', async () => {
    const { applier, metrics, repos } = buildApplier();
    repos.proposals.findDaoIdForSource.mockResolvedValue(undefined);
    await applier.applyBatch([makeRow({ event_type: 'StartVote' })]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });
});
