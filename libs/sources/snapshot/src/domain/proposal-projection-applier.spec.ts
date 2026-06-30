import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OffchainArchiveRow } from '@libs/db';
import {
  SnapshotProposalProjectionApplier,
  type SnapshotProjectionRepos,
} from './proposal-projection-applier';
import type { SnapshotProposalPayload } from './types';

const ROW: OffchainArchiveRow = {
  id: 'r1',
  source_type: 'snapshot',
  dao_source_id: 'src-1',
  chain_id: 'off-chain',
  external_id: 'prop:0xprop',
  derivation_ordinal: '100',
  event_type: 'SnapshotProposalCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

function basePayload(overrides: Partial<SnapshotProposalPayload> = {}): SnapshotProposalPayload {
  return {
    id: '0xprop',
    created: 1_700_000_000,
    title: 'T',
    body: 'B',
    choices: ['For', 'Against'],
    type: 'single-choice',
    start: 1_700_000_100,
    end: 1_700_000_900,
    state: 'active',
    scores_total: 1,
    scores_state: 'pending',
    author: '0xAUTHOR',
    space: { id: 'lido-snapshot.eth' },
    ...overrides,
  };
}

function makeRepos() {
  return {
    proposals: {
      findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
      findBySource: vi.fn().mockResolvedValue(undefined),
      insertProposal: vi.fn().mockResolvedValue({ inserted: true, proposalId: 'p-1' }),
      ensureChoices: vi.fn().mockResolvedValue(undefined),
      reindexChoices: vi.fn().mockResolvedValue(undefined),
      updateDerivedFields: vi.fn().mockResolvedValue(undefined),
      setStateFromDerivation: vi.fn().mockResolvedValue(undefined),
    },
    actors: {
      findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }),
    },
    snapshotProposals: {
      upsertMetadata: vi.fn().mockResolvedValue(undefined),
    },
    archive: {
      markDerived: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('SnapshotProposalProjectionApplier', () => {
  let repos: ReturnType<typeof makeRepos>;
  let payloadJson: string;
  let deps: {
    pgDb: unknown;
    payloads: { fetchLatest: ReturnType<typeof vi.fn> };
    archive: { incrementAttemptCount: ReturnType<typeof vi.fn> };
    logger: { error: ReturnType<typeof vi.fn> };
    withTransaction: (fn: (r: SnapshotProjectionRepos) => Promise<void>) => Promise<void>;
  };

  function build(payload: SnapshotProposalPayload) {
    payloadJson = JSON.stringify(payload);
    deps = {
      pgDb: {},
      payloads: {
        fetchLatest: vi
          .fn()
          .mockResolvedValue([{ external_id: ROW.external_id, payload: payloadJson }]),
      },
      archive: { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) },
      logger: { error: vi.fn() },
      withTransaction: (fn) => fn(repos as unknown as SnapshotProjectionRepos),
    };
    return new SnapshotProposalProjectionApplier(deps as never);
  }

  beforeEach(() => {
    repos = makeRepos();
  });

  it('inserts a new proposal + metadata + choices and marks derived', async () => {
    const applier = build(basePayload());
    await applier.applyBatch([ROW]);

    expect(repos.actors.findOrCreateActorAddress).toHaveBeenCalledWith(
      '0xauthor',
      'proposer_event',
    );
    expect(repos.proposals.insertProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        dao_id: 'dao-1',
        source_type: 'snapshot',
        source_id: '0xprop',
        binding: false,
        state: 'active',
      }),
    );
    expect(repos.proposals.ensureChoices).toHaveBeenCalledWith('p-1', [
      { proposal_id: '', choice_index: 0, value: 'For' },
      { proposal_id: '', choice_index: 1, value: 'Against' },
    ]);
    expect(repos.snapshotProposals.upsertMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ proposal_id: 'p-1', space_id: 'lido-snapshot.eth' }),
    );
    expect(repos.archive.markDerived).toHaveBeenCalledWith('r1');
  });

  it('on edit (insert conflict) updates fields, reindexes choices, and sets state via the bypass', async () => {
    repos.proposals.insertProposal.mockResolvedValue({ inserted: false });
    repos.proposals.findBySource.mockResolvedValue({ id: 'p-1' });
    const applier = build(
      basePayload({ title: 'Edited', state: 'closed', scores_state: 'final', scores_total: 3 }),
    );

    await applier.applyBatch([ROW]);

    expect(repos.proposals.updateDerivedFields).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'p-1', title: 'Edited' }),
    );
    expect(repos.proposals.reindexChoices).toHaveBeenCalledWith('p-1', expect.any(Array));
    expect(repos.proposals.setStateFromDerivation).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'p-1', state: 'succeeded' }),
    );
    expect(repos.proposals.ensureChoices).not.toHaveBeenCalled();
    expect(repos.archive.markDerived).toHaveBeenCalledWith('r1');
  });

  it('skips a flagged proposal (no proposal row) but marks derived', async () => {
    const applier = build(basePayload({ flagged: true }));
    await applier.applyBatch([ROW]);

    expect(repos.proposals.insertProposal).not.toHaveBeenCalled();
    expect(repos.proposals.findDaoIdForSource).not.toHaveBeenCalled();
    expect(repos.archive.markDerived).toHaveBeenCalledWith('r1');
  });

  it('cancels an existing proposal on a deletion sentinel', async () => {
    repos.proposals.findBySource.mockResolvedValue({ id: 'p-1' });
    const applier = build({ id: '0xprop', created: 1, deleted: true });

    await applier.applyBatch([ROW]);

    expect(repos.proposals.setStateFromDerivation).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'p-1', state: 'canceled' }),
    );
    expect(repos.archive.markDerived).toHaveBeenCalledWith('r1');
  });

  it('is a no-op (still marks derived) when a deletion targets an unknown proposal', async () => {
    repos.proposals.findBySource.mockResolvedValue(undefined);
    const applier = build({ id: '0xprop', created: 1, deleted: true });

    await applier.applyBatch([ROW]);

    expect(repos.proposals.setStateFromDerivation).not.toHaveBeenCalled();
    expect(repos.archive.markDerived).toHaveBeenCalledWith('r1');
  });

  it('increments attempt + logs when the payload is missing from the archive', async () => {
    const applier = build(basePayload());
    deps.payloads.fetchLatest.mockResolvedValue([]); // nothing for this external_id

    await applier.applyBatch([ROW]);

    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
    expect(deps.logger.error).toHaveBeenCalled();
    expect(repos.proposals.insertProposal).not.toHaveBeenCalled();
  });

  it('fails the row when a derivable proposal has no author', async () => {
    const applier = build(basePayload({ author: null }));
    await applier.applyBatch([ROW]);

    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
    expect(repos.archive.markDerived).not.toHaveBeenCalled();
  });

  it('fails the row on an undecodable payload', async () => {
    const applier = build(basePayload());
    deps.payloads.fetchLatest.mockResolvedValue([
      { external_id: ROW.external_id, payload: 'not json' },
    ]);

    await applier.applyBatch([ROW]);

    expect(deps.archive.incrementAttemptCount).toHaveBeenCalledWith('r1');
    expect(repos.proposals.insertProposal).not.toHaveBeenCalled();
  });

  it('ignores an empty batch', async () => {
    const applier = build(basePayload());
    await applier.applyBatch([]);
    expect(deps.payloads.fetchLatest).not.toHaveBeenCalled();
  });

  it('uses the default pgDb transaction runner when none is injected', async () => {
    // A self-returning fake tx so the real repos can run the flagged path (markDerived only).
    const fakeTx: Record<string, unknown> = {};
    for (const method of [
      'updateTable',
      'set',
      'where',
      'insertInto',
      'values',
      'onConflict',
      'selectFrom',
      'select',
      'selectAll',
      'deleteFrom',
      'innerJoin',
      'returning',
      'orderBy',
      'limit',
    ]) {
      fakeTx[method] = () => fakeTx;
    }
    fakeTx['execute'] = () => Promise.resolve([]);
    fakeTx['executeTakeFirst'] = () => Promise.resolve(undefined);

    const pgDb = {
      transaction: () => ({ execute: (fn: (tx: unknown) => Promise<void>) => fn(fakeTx) }),
    };
    const applier = new SnapshotProposalProjectionApplier({
      pgDb,
      payloads: {
        fetchLatest: vi.fn().mockResolvedValue([
          {
            external_id: ROW.external_id,
            payload: JSON.stringify(basePayload({ flagged: true })),
          },
        ]),
      },
      archive: { incrementAttemptCount: vi.fn() },
      logger: { error: vi.fn() },
    } as never);

    await expect(applier.applyBatch([ROW])).resolves.toBeUndefined();
  });
});
