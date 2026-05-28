import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PgOrphanSweepService } from './pg-orphan-sweep.service';

describe('PgOrphanSweepService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes missing CH tuples to DLQ and advances composite cursor', async () => {
    const daoSources = {
      findActive: vi.fn().mockResolvedValue([]),
      findActiveByIdWithChain: vi.fn().mockResolvedValue({
        id: 'src-1',
        source_type: 'compound_governor_bravo',
        primary_chain_id: '0x1',
        active_from_block: '0',
      }),
    };
    const watermarkRepo = {
      find: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const archiveEvents = {
      listByDaoSourceAfterCursor: vi.fn().mockResolvedValue([
        {
          id: 'a1',
          source_type: 'compound_governor_bravo',
          chain_id: '0x1',
          tx_hash: '0xtx1',
          log_index: 2,
          block_hash: '0xb1',
          block_number: '100',
        },
      ]),
    };
    const dlqRepo = { insert: vi.fn().mockResolvedValue(undefined) };

    const svc = new PgOrphanSweepService(
      daoSources as never,
      watermarkRepo as never,
      archiveEvents as never,
      dlqRepo as never,
    );
    vi.spyOn(svc as never, 'readChHits' as never).mockResolvedValue([]);

    await svc.runOnce('src-1');

    expect(dlqRepo.insert).toHaveBeenCalledTimes(1);
    expect(watermarkRepo.upsert).toHaveBeenCalledWith('pg_orphan', 'src-1', {
      blockNumber: 100n,
      txHash: '0xtx1',
      logIndex: 2,
    });
  });

  it('does not write DLQ when tuple exists in CH', async () => {
    const daoSources = {
      findActive: vi.fn().mockResolvedValue([]),
      findActiveByIdWithChain: vi.fn().mockResolvedValue({
        id: 'src-1',
        source_type: 'compound_governor_bravo',
        primary_chain_id: '0x1',
        active_from_block: '0',
      }),
    };
    const watermarkRepo = {
      find: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const archiveEvents = {
      listByDaoSourceAfterCursor: vi.fn().mockResolvedValue([
        {
          id: 'a1',
          source_type: 'compound_governor_bravo',
          chain_id: '0x1',
          tx_hash: '0xtx1',
          log_index: 2,
          block_hash: '0xb1',
          block_number: '100',
        },
      ]),
    };
    const dlqRepo = { insert: vi.fn().mockResolvedValue(undefined) };

    const svc = new PgOrphanSweepService(
      daoSources as never,
      watermarkRepo as never,
      archiveEvents as never,
      dlqRepo as never,
    );
    vi.spyOn(svc as never, 'readChHits' as never).mockResolvedValue([
      { chain_id: '0x1', tx_hash: '0xtx1', log_index: 2 },
    ]);

    await svc.runOnce('src-1');

    expect(dlqRepo.insert).not.toHaveBeenCalled();
    expect(watermarkRepo.upsert).toHaveBeenCalledTimes(1);
  });
});
