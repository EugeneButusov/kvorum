import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { EasyTrackMotionProjectionApplier } from './motion-projection-applier';

const CREATOR = '0x' + '11'.repeat(20);
const FACTORY = '0x' + '22'.repeat(20);
const BLOCK_HASH = '0x' + 'bb'.repeat(32);
const BLOCK_NUMBER = '13700000';
const BLOCK_TS_SEC = 1767225600; // 2026-01-01T00:00:00Z
const DURATION = '259200'; // 72h

function makeRow(overrides: Partial<ArchiveDerivationRow>): ArchiveDerivationRow {
  return {
    id: 'archive-1',
    source_type: 'easy_track',
    dao_source_id: 'source-1',
    chain_id: '0x1',
    block_number: BLOCK_NUMBER,
    block_hash: BLOCK_HASH,
    tx_hash: '0xtx',
    log_index: 1,
    event_type: 'MotionCreated',
    received_at: new Date('2026-01-01T00:05:00Z'),
    derivation_attempt_count: 0,
    ...overrides,
  } as ArchiveDerivationRow;
}

function makePayload(payload: unknown, eventType = 'MotionCreated') {
  return {
    chain_id: '0x1',
    tx_hash: '0xtx',
    log_index: 1,
    block_hash: BLOCK_HASH,
    event_type: eventType,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    received_at: new Date('2026-01-01T00:05:00Z'),
  };
}

interface MutableApplier {
  transaction: ReturnType<typeof vi.fn>;
}

function buildApplier(opts?: {
  payloads?: ReturnType<typeof makePayload>[];
  duration?: string | null;
  chainAvailable?: boolean;
}) {
  const archive = {
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    markDerived: vi.fn().mockResolvedValue(undefined),
  };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const payloads = {
    fetchPayloads: vi.fn().mockResolvedValue(
      opts?.payloads ?? [
        makePayload({
          motionId: '42',
          creator: CREATOR,
          evmScriptFactory: FACTORY,
          evmScript: '0x00000001', // valid, empty (spec-1 no calls)
        }),
      ],
    ),
    findDurationAsOf: vi
      .fn()
      .mockResolvedValue(opts?.duration === undefined ? DURATION : opts.duration),
  };
  const chainCtx = {
    chainCfg: { chainId: '0x1' },
    client: {
      send: vi.fn().mockResolvedValue({
        hash: BLOCK_HASH,
        number: BLOCK_NUMBER,
        timestamp: String(BLOCK_TS_SEC),
      }),
    },
  };
  const registry = {
    peek: vi.fn().mockReturnValue(opts?.chainAvailable === false ? undefined : chainCtx),
  };
  const metrics = { batchLookupSeconds: vi.fn(), processed: vi.fn() };

  const applier = new EasyTrackMotionProjectionApplier({
    pgDb: {} as never,
    archive: archive as never,
    dlq: dlq as never,
    payloads: payloads as never,
    registry: registry as never,
    metrics,
  });

  const repos = {
    actors: { findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }) },
    proposals: {
      findDaoIdForSource: vi.fn().mockResolvedValue('dao-1'),
      insertProposal: vi.fn().mockResolvedValue({ inserted: true, proposalId: 'p-1' }),
      insertActions: vi.fn().mockResolvedValue(0),
      advanceState: vi.fn().mockResolvedValue(1),
      findBySource: vi.fn().mockResolvedValue({ id: 'p-1', dao_id: 'dao-1' }),
    },
    motions: {
      insert: vi.fn().mockResolvedValue(undefined),
      setState: vi.fn().mockResolvedValue(undefined),
      annotateObjected: vi.fn().mockResolvedValue(undefined),
    },
    archive: { markDerived: vi.fn().mockResolvedValue(undefined) },
  };
  (applier as unknown as MutableApplier).transaction = vi.fn(
    (fn: (r: typeof repos) => Promise<void>) => fn(repos),
  );
  return { applier, archive, dlq, payloads, registry, metrics, repos };
}

describe('EasyTrackMotionProjectionApplier', () => {
  it('declares the easy_track motion-projection contract', () => {
    const { applier } = buildApplier();
    expect(applier.kind).toBe('projection');
    expect([...applier.sourceTypes]).toEqual(['easy_track']);
    expect([...applier.eventTypes]).toEqual([
      'MotionCreated',
      'MotionObjected',
      'MotionEnacted',
      'MotionRejected',
      'MotionCanceled',
    ]);
  });

  it('returns early on an empty batch', async () => {
    const { applier, payloads } = buildApplier();
    await applier.applyBatch([]);
    expect(payloads.fetchPayloads).not.toHaveBeenCalled();
  });

  it('derives MotionCreated → active proposal + motion meta with objection window = blockTs + duration', async () => {
    const { applier, repos, metrics } = buildApplier();
    await applier.applyBatch([makeRow({ event_type: 'MotionCreated' })]);

    expect(repos.actors.findOrCreateActorAddress).toHaveBeenCalledWith(CREATOR, 'proposer_event');
    const expectedEnds = new Date(BLOCK_TS_SEC * 1000 + Number(DURATION) * 1000);
    expect(repos.proposals.insertProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        dao_id: 'dao-1',
        proposer_actor_id: 'actor-1',
        source_type: 'easy_track',
        source_id: '42',
        state: 'active',
        binding: true,
        voting_starts_at: new Date(BLOCK_TS_SEC * 1000),
        voting_ends_at: expectedEnds,
      }),
    );
    expect(repos.motions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal_id: 'p-1',
        motion_id: '42',
        factory_address: FACTORY,
        objection_ends_at: expectedEnds,
        state: 'active',
      }),
    );
    expect(repos.archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'derived' }));
  });

  it('falls back to the default 72h duration when no MotionDurationChanged precedes the motion', async () => {
    const { applier, repos } = buildApplier({ duration: null });
    await applier.applyBatch([makeRow({ event_type: 'MotionCreated' })]);
    const expectedEnds = new Date(BLOCK_TS_SEC * 1000 + 72 * 60 * 60 * 1000);
    expect(repos.motions.insert).toHaveBeenCalledWith(
      expect.objectContaining({ objection_ends_at: expectedEnds }),
    );
  });

  it('decodes the motion EVMScript into proposal_action rows', async () => {
    const target = '0x' + '33'.repeat(20);
    // spec-1 EVMScript: one direct call to `target` with calldata 0xabcdef (3 bytes).
    const script = '0x00000001' + '33'.repeat(20) + '00000003' + 'abcdef';
    const { applier, repos } = buildApplier({
      payloads: [
        makePayload({
          motionId: '42',
          creator: CREATOR,
          evmScriptFactory: FACTORY,
          evmScript: script,
        }),
      ],
    });
    await applier.applyBatch([makeRow({ event_type: 'MotionCreated' })]);
    expect(repos.proposals.insertActions).toHaveBeenCalledWith('p-1', [
      expect.objectContaining({
        targetAddress: target,
        targetChainId: '0x1',
        valueWei: '0',
        functionSignature: null,
        calldata: '0xabcdef',
      }),
    ]);
  });

  it('creates the proposal without actions when the EVMScript is malformed (best-effort)', async () => {
    const { applier, repos, metrics } = buildApplier({
      payloads: [
        makePayload({
          motionId: '42',
          creator: CREATOR,
          evmScriptFactory: FACTORY,
          evmScript: '0xZZ',
        }),
      ],
    });
    await applier.applyBatch([makeRow({ event_type: 'MotionCreated' })]);
    expect(repos.proposals.insertProposal).toHaveBeenCalled();
    expect(repos.proposals.insertActions).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'derived' }));
  });

  it('skips an idempotent MotionCreated re-derivation (no meta insert)', async () => {
    const { applier, repos, metrics } = buildApplier();
    repos.proposals.insertProposal.mockResolvedValue({ inserted: false });
    await applier.applyBatch([makeRow({ event_type: 'MotionCreated' })]);
    expect(repos.motions.insert).not.toHaveBeenCalled();
    expect(repos.archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_idempotent' }),
    );
  });

  it('fails MotionCreated (no proposal write) when the block timestamp is unavailable', async () => {
    const { applier, repos, archive, metrics } = buildApplier({ chainAvailable: false });
    await applier.applyBatch([makeRow({ event_type: 'MotionCreated' })]);
    expect(repos.proposals.insertProposal).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'block_timestamp_unavailable' }),
    );
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
  });

  it.each([
    ['MotionEnacted', 'executed', 'enacted'],
    ['MotionRejected', 'defeated', 'rejected'],
    ['MotionCanceled', 'canceled', 'canceled'],
  ] as const)(
    'advances %s → proposal %s + motion %s',
    async (eventType, proposalState, motionState) => {
      const { applier, repos } = buildApplier({
        payloads: [makePayload({ motionId: '42' }, eventType)],
      });
      await applier.applyBatch([makeRow({ event_type: eventType })]);
      expect(repos.proposals.advanceState).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: '42', targetState: proposalState }),
      );
      expect(repos.motions.setState).toHaveBeenCalledWith('p-1', motionState);
      expect(repos.archive.markDerived).toHaveBeenCalledWith('archive-1');
    },
  );

  it('annotates MotionObjected on the meta, leaving the proposal active', async () => {
    const { applier, repos } = buildApplier({
      payloads: [makePayload({ motionId: '42', objector: CREATOR }, 'MotionObjected')],
    });
    await applier.applyBatch([makeRow({ event_type: 'MotionObjected' })]);
    expect(repos.motions.annotateObjected).toHaveBeenCalledWith('p-1');
    expect(repos.proposals.advanceState).not.toHaveBeenCalled();
    expect(repos.archive.markDerived).toHaveBeenCalledWith('archive-1');
  });

  it('defers a terminal event whose MotionCreated has not derived yet (no markDerived)', async () => {
    const { applier, repos, metrics } = buildApplier({
      payloads: [makePayload({ motionId: '99' }, 'MotionEnacted')],
    });
    repos.proposals.findBySource.mockResolvedValue(undefined);
    await applier.applyBatch([makeRow({ event_type: 'MotionEnacted' })]);
    expect(repos.proposals.advanceState).not.toHaveBeenCalled();
    expect(repos.archive.markDerived).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'deferred' }),
    );
  });

  it('defers MotionObjected whose MotionCreated has not derived yet', async () => {
    const { applier, repos, metrics } = buildApplier({
      payloads: [makePayload({ motionId: '99', objector: CREATOR }, 'MotionObjected')],
    });
    repos.proposals.findBySource.mockResolvedValue(undefined);
    await applier.applyBatch([makeRow({ event_type: 'MotionObjected' })]);
    expect(repos.motions.annotateObjected).not.toHaveBeenCalled();
    expect(repos.archive.markDerived).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'deferred' }),
    );
  });

  it('fails a row whose archive payload is missing', async () => {
    const { applier, archive, metrics } = buildApplier({ payloads: [] });
    await applier.applyBatch([makeRow({ event_type: 'MotionCreated' })]);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'payload_missing' }),
    );
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
  });

  it('fails (decode_error) a row whose event_type is not a motion lifecycle event', async () => {
    const { applier, metrics } = buildApplier({
      payloads: [makePayload({ motionDuration: '259200' }, 'MotionDurationChanged')],
    });
    await applier.applyBatch([makeRow({ event_type: 'MotionDurationChanged' })]);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'decode_error' }),
    );
  });

  it('records skipped_state_guard when a terminal advanceState changes nothing (already terminal)', async () => {
    const { applier, repos, metrics } = buildApplier({
      payloads: [makePayload({ motionId: '42' }, 'MotionEnacted')],
    });
    repos.proposals.advanceState.mockResolvedValue(0);
    await applier.applyBatch([makeRow({ event_type: 'MotionEnacted' })]);
    expect(repos.motions.setState).toHaveBeenCalledWith('p-1', 'enacted');
    expect(repos.archive.markDerived).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_state_guard' }),
    );
  });

  it('fails (projection_apply_error) when the dao_source is unknown', async () => {
    const { applier, metrics, repos } = buildApplier();
    repos.proposals.findDaoIdForSource.mockResolvedValue(undefined);
    await applier.applyBatch([makeRow({ event_type: 'MotionCreated' })]);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });
});
