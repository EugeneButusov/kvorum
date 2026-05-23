import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { DerivationWorkerService } from './derivation-worker.service';

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
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 2,
};

describe('DerivationWorkerService', () => {
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
      findConfirmedDerivableBy: vi.fn().mockResolvedValue([ROW]),
    };
    const worker = new DerivationWorkerService(archive as never, actorResolution as never, [
      bundleWith(applier),
    ]);

    await worker.tick();

    expect(actorResolution.findConfirmedDerivableBy).toHaveBeenCalledWith(
      ['test_event_created'],
      50,
    );
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
  });

  it('applies projection with the matching source applier', async () => {
    const archive = {
      incrementAttemptCount: vi.fn(),
    };
    const actorResolution = {
      findConfirmedDerivableBy: vi.fn().mockResolvedValue([ROW]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo'],
      eventTypes: ['test_event_created'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(archive as never, actorResolution as never, [
      bundleWith(applier),
    ]);

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledWith([ROW]);
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
  });

  it('does not apply when event_type does not match applier', async () => {
    const archive = {
      incrementAttemptCount: vi.fn(),
    };
    const actorResolution = {
      findConfirmedDerivableBy: vi.fn().mockResolvedValue([ROW]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo'],
      eventTypes: ['different_event'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(archive as never, actorResolution as never, [
      bundleWith(applier),
    ]);

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
      findConfirmedDerivableBy: vi.fn().mockResolvedValue([alphaRow]),
    };
    const applier = {
      kind: 'projection' as const,
      sourceTypes: ['test_source_bravo', 'test_source_alpha'],
      eventTypes: ['test_event_created'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(archive as never, actorResolution as never, [
      bundleWith(applier),
    ]);

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledWith([alphaRow]);
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
  });
});

function bundleWith(applier: {
  kind: 'projection';
  sourceTypes: string[];
  eventTypes: string[];
  applyBatch: (rows: readonly ArchiveDerivationRow[]) => Promise<void>;
}) {
  return { name: 'test', ingesters: [], derivers: [applier] };
}
