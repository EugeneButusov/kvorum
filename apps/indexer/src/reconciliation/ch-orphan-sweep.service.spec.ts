import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChOrphanSweepService } from './ch-orphan-sweep.service';

vi.mock('@libs/chain', () => ({
  parseChainConfigFromEnv: vi.fn().mockReturnValue([{ chainId: '0x1', name: 'eth', headLag: 12 }]),
  readConfirmedHead: vi.fn().mockResolvedValue(20n),
  ChainContextRegistry: class {},
}));

describe('ChOrphanSweepService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recovers missing tuples and advances watermark to upper bound', async () => {
    const daoSources = {
      findActiveByChain: vi
        .fn()
        .mockResolvedValue([
          {
            id: 'src-1',
            source_type: 'compound_governor_bravo',
            primary_chain_id: '0x1',
            active_from_block: '10',
          },
        ]),
      findActive: vi
        .fn()
        .mockResolvedValue([
          {
            id: 'src-1',
            source_type: 'compound_governor_bravo',
            primary_chain_id: '0x1',
            active_from_block: '10',
          },
        ]),
    };
    const archiveEvents = {
      findExistingTuples: vi.fn().mockResolvedValue(new Set()),
      insert: vi.fn().mockResolvedValue({ id: 'a1' }),
    };
    const watermarkRepo = {
      find: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const chainRegistry = { getOrCreate: vi.fn().mockResolvedValue({ client: {} }) };

    const svc = new ChOrphanSweepService(
      daoSources as never,
      archiveEvents as never,
      watermarkRepo as never,
      chainRegistry as never,
      ['ProposalCreated'],
    );

    vi.spyOn(svc as never, 'readCombinedChRows' as never).mockResolvedValue([
      {
        dao_source_id: 'src-1',
        chain_id: '0x1',
        block_number: '12',
        block_hash: '0xb',
        tx_hash: '0xtx',
        log_index: 1,
        event_type: 'ProposalCreated',
      },
    ]);

    await svc.runOnce('0x1');

    expect(archiveEvents.insert).toHaveBeenCalledTimes(1);
    expect(watermarkRepo.upsert).toHaveBeenCalledWith('ch_orphan', 'src-1', {
      blockNumber: 15n,
    });
  });

  it('skips when chain is already in flight', async () => {
    const daoSources = { findActiveByChain: vi.fn(), findActive: vi.fn() };
    const archiveEvents = { findExistingTuples: vi.fn(), insert: vi.fn() };
    const watermarkRepo = { find: vi.fn(), upsert: vi.fn() };
    const chainRegistry = { getOrCreate: vi.fn() };

    const svc = new ChOrphanSweepService(
      daoSources as never,
      archiveEvents as never,
      watermarkRepo as never,
      chainRegistry as never,
      ['ProposalCreated'],
    );

    (svc as unknown as { inFlight: Map<string, boolean> }).inFlight.set('0x1', true);
    await svc.runOnce('0x1');

    expect(daoSources.findActiveByChain).not.toHaveBeenCalled();
  });
});
