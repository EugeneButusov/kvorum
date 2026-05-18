import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { DerivationWorkerService } from './derivation-worker.service';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'compound_governor_bravo',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'ProposalCreated',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 2,
};

describe('DerivationWorkerService', () => {
  it('increments attempt count when source has no projection applier', async () => {
    const archive = {
      findConfirmedUndderived: vi.fn().mockResolvedValue([ROW]),
      incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(archive as never, []);

    await worker.tick();

    expect(archive.findConfirmedUndderived).toHaveBeenCalledWith(50);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
  });

  it('applies projection with the matching source applier', async () => {
    const archive = {
      findConfirmedUndderived: vi.fn().mockResolvedValue([ROW]),
      incrementAttemptCount: vi.fn(),
    };
    const applier = {
      sourceTypes: ['compound_governor_bravo'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(archive as never, [applier]);

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledWith([ROW]);
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
  });

  it('routes alpha rows to an applier that supports compound_governor_alpha', async () => {
    const alphaRow = { ...ROW, source_type: 'compound_governor_alpha' };
    const archive = {
      findConfirmedUndderived: vi.fn().mockResolvedValue([alphaRow]),
      incrementAttemptCount: vi.fn(),
    };
    const applier = {
      sourceTypes: ['compound_governor_bravo', 'compound_governor_alpha'],
      applyBatch: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new DerivationWorkerService(archive as never, [applier]);

    await worker.tick();

    expect(applier.applyBatch).toHaveBeenCalledWith([alphaRow]);
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
  });
});
