import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { DerivationWorkerService } from './derivation-worker.service';

vi.mock('./derivation-metrics', () => ({
  derivationMetrics: {
    lagSeconds: { record: vi.fn() },
    processed: { add: vi.fn() },
    tickDurationSeconds: { record: vi.fn() },
    batchLookupSeconds: { record: vi.fn() },
    chWriteSeconds: { record: vi.fn() },
    timestampFill: { add: vi.fn() },
    timestampFillBacklog: { record: vi.fn() },
  },
}));

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'test_source_bravo',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'test_event_created',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 2,
};

const OFFCHAIN_ROW = {
  id: 'oc-1',
  source_type: 'snapshot',
  dao_source_id: 'source-1',
  chain_id: 'off-chain',
  external_id: 'prop:0xabc',
  derivation_ordinal: '100',
  event_type: 'SnapshotProposalCreated' as const,
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

describe('DerivationWorkerService', () => {
  it('dispatches off-chain rows to an offchain-projection applier', async () => {
    const offchainApplier = {
      kind: 'offchain-projection' as const,
      sourceTypes: ['snapshot'],
      eventTypes: ['SnapshotProposalCreated'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const archive = { incrementAttemptCount: vi.fn() };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([OFFCHAIN_ROW]),
    };
    const worker = new DerivationWorkerService(
      archive as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleOffchain(offchainApplier)],
    );

    await worker.tick();

    expect(actorResolution.findDerivableByOffchain).toHaveBeenCalledWith(
      ['SnapshotProposalCreated'],
      50,
    );
    expect(offchainApplier.applyBatch).toHaveBeenCalledWith([OFFCHAIN_ROW]);
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
  });

  it('increments attempt for an off-chain row with no matching applier', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([OFFCHAIN_ROW]),
    };
    const worker = new DerivationWorkerService(
      archive as never,
      actorResolution as never,
      makeRegistry() as never,
      [],
    );

    await worker.tick();

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('oc-1');
  });

  it('runs an initial tick on bootstrap', async () => {
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const worker = new DerivationWorkerService(
      {} as never,
      actorResolution as never,
      makeRegistry() as never,
      [],
    );

    await worker.onApplicationBootstrap();

    expect(actorResolution.findDerivableBy).toHaveBeenCalled();
  });

  it('increments attempt count when source has no projection applier', async () => {
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_alpha'],
      eventTypes: ['test_event_created'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const archive = {
      incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([ROW]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const worker = new DerivationWorkerService(
      archive as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    expect(actorResolution.findDerivableBy).toHaveBeenCalledWith(['test_event_created'], 50);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
  });

  it('applies projection with the matching source applier', async () => {
    const archive = {
      incrementAttemptCount: vi.fn(),
    };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([ROW]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo'],
      eventTypes: ['test_event_created'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(
      archive as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledWith([ROW]);
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
  });

  it('does not apply when event_type does not match applier', async () => {
    const archive = {
      incrementAttemptCount: vi.fn(),
    };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([ROW]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo'],
      eventTypes: ['different_event'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(
      archive as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    expect(applier.applyBatch).not.toHaveBeenCalled();
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
  });

  it('routes alpha rows to an applier that supports test_source_alpha', async () => {
    const alphaRow = { ...ROW, source_type: 'test_source_alpha' };
    const archive = {
      incrementAttemptCount: vi.fn(),
    };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([alphaRow]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo', 'test_source_alpha'],
      eventTypes: ['test_event_created'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(
      archive as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledWith([alphaRow]);
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
  });

  it('dispatches same-named events by source_type and marks unsupported peer sources', async () => {
    const rowA = {
      ...ROW,
      id: 'archive-a',
      source_type: 'test_source_primary',
      event_type: 'test_event_shared',
    };
    const rowB = {
      ...ROW,
      id: 'archive-b',
      source_type: 'test_source_secondary',
      event_type: 'test_event_shared',
    };
    const archive = {
      incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([rowA, rowB]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_primary'],
      eventTypes: ['test_event_shared'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(
      archive as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledWith([rowA]);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-b');
  });

  it('skips tick when already in flight', async () => {
    const actorResolution = {
      findDerivableBy: vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 50))),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const worker = new DerivationWorkerService(
      { incrementAttemptCount: vi.fn() } as never,
      actorResolution as never,
      makeRegistry() as never,
      [],
    );

    const p1 = worker.tick();
    await worker.tick(); // should return early (in-flight)
    await p1;

    expect(actorResolution.findDerivableBy).toHaveBeenCalledTimes(1);
  });

  it('records lag=0 and returns when watermark is empty', async () => {
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const worker = new DerivationWorkerService(
      {} as never,
      actorResolution as never,
      makeRegistry() as never,
      [],
    );

    await worker.tick();

    expect(actorResolution.findDerivableBy).toHaveBeenCalled();
  });

  it('logs error and continues when tick throws', async () => {
    const actorResolution = { findDerivableBy: vi.fn().mockRejectedValue(new Error('db down')) };
    const worker = new DerivationWorkerService(
      {} as never,
      actorResolution as never,
      makeRegistry() as never,
      [],
    );

    await expect(worker.tick()).resolves.toBeUndefined();
  });

  it('groups two rows with same dispatch key into one applyBatch call', async () => {
    const row2 = { ...ROW, id: 'archive-2', tx_hash: '0xtx2' };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([ROW, row2]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo'],
      eventTypes: ['test_event_created'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(
      {} as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledWith([ROW, row2]);
  });

  it('splits a multi-chain batch into one applyBatch call per chain', async () => {
    const rowA = { ...ROW, id: 'archive-a', chain_id: '0x1' };
    const rowB = { ...ROW, id: 'archive-b', chain_id: '0x89' };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([rowA, rowB]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo'],
      eventTypes: ['test_event_created'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(
      {} as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledTimes(2);
    expect(applier.applyBatch).toHaveBeenCalledWith([rowA]);
    expect(applier.applyBatch).toHaveBeenCalledWith([rowB]);
  });

  it('splits rows with same source and chain but different event_type', async () => {
    const rowA = { ...ROW, id: 'archive-a', event_type: 'test_event_created' };
    const rowB = { ...ROW, id: 'archive-b', event_type: 'test_event_closed' };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([rowA, rowB]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo'],
      eventTypes: ['test_event_created', 'test_event_closed'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(
      {} as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledTimes(2);
    expect(applier.applyBatch).toHaveBeenCalledWith([rowA]);
    expect(applier.applyBatch).toHaveBeenCalledWith([rowB]);
  });

  it('dispatches rows without cutoff gating', async () => {
    const highRow = { ...ROW, block_number: '300' };
    const archive = { incrementAttemptCount: vi.fn() };
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([highRow]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo'],
      eventTypes: ['test_event_created'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(
      archive as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledWith([highRow]);
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
  });

  it('preserves block order across event types within a batch', async () => {
    // Reproduces the production failure: a batch whose FIRST row is a later-block ProposalCanceled
    // (for an earlier proposal) used to pull EVERY cancel ahead of EVERY create, so a proposal's
    // cancel was applied before the create that made it exist — advanceState matched no row and the
    // transition was dropped. Compound bravo #347/#348 and alpha #4 were stuck this way.
    const earlierCancel = {
      ...ROW,
      id: 'a-cancel-early',
      block_number: '90',
      event_type: 'test_event_canceled' as const,
    };
    const create348 = { ...ROW, id: 'a-create-348', block_number: '100' };
    const cancel348 = {
      ...ROW,
      id: 'a-cancel-348',
      block_number: '110',
      event_type: 'test_event_canceled' as const,
    };
    // Selected in block order: cancel@90, create@100, cancel@110.
    const actorResolution = {
      findDerivableBy: vi.fn().mockResolvedValue([earlierCancel, create348, cancel348]),
      findDerivableByOffchain: vi.fn().mockResolvedValue([]),
    };
    const seen: string[] = [];
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo'],
      eventTypes: ['test_event_created', 'test_event_canceled'],
      applyBatch: vi.fn(async (rows: { id: string }[]) => {
        for (const row of rows) seen.push(row.id);
      }),
    };
    const worker = new DerivationWorkerService(
      {} as never,
      actorResolution as never,
      makeRegistry() as never,
      [bundleWith(applier)],
    );

    await worker.tick();

    // The create must reach the applier before the cancel that depends on it.
    expect(seen).toEqual(['a-cancel-early', 'a-create-348', 'a-cancel-348']);
    expect(seen.indexOf('a-create-348')).toBeLessThan(seen.indexOf('a-cancel-348'));
    // Three consecutive runs, each homogeneous — appliers still get one event type per batch.
    expect(applier.applyBatch).toHaveBeenCalledTimes(3);
  });
});

function makeRegistry() {
  return {
    peek: vi.fn().mockReturnValue(undefined),
  };
}

function bundleWith(applier: {
  kind: 'projection';
  sourceTypes: string[];
  eventTypes: string[];
  applyBatch: (rows: readonly ArchiveDerivationRow[]) => Promise<void>;
}) {
  return {
    name: 'test',
    ingesters: [],
    derivers: [applier],
    readExtension: {
      sourceTypes: [],
      choiceBounds: () => ({ min: 0, max: 2 }),
      delegationModel: () => 'power-bearing' as const,
      getProposalExtension: () => Promise.resolve(null),
    },
  };
}

function bundleOffchain(applier: {
  kind: 'offchain-projection';
  sourceTypes: string[];
  eventTypes: string[];
  applyBatch: (rows: readonly unknown[]) => Promise<void>;
}) {
  return {
    name: 'test-offchain',
    ingesters: [],
    derivers: [applier],
    readExtension: {
      sourceTypes: [],
      choiceBounds: () => ({ min: 0, max: 2 }),
      delegationModel: () => 'power-bearing' as const,
      getProposalExtension: () => Promise.resolve(null),
    },
  };
}
