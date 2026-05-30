import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainContextRegistry } from '@libs/chain';
import { parseChainConfigFromEnv, readConfirmedHead } from '@libs/chain';
import { SeenLogPruneService } from './seen-log-prune.service';

// Hoist mock objects so vi.mock factories can close over them.
const { seenLog, daoSourceRepo } = vi.hoisted(() => ({
  seenLog: { pruneBelow: vi.fn<[string, bigint], Promise<number>>().mockResolvedValue(0) },
  daoSourceRepo: {
    findAll: vi
      .fn<[], Promise<{ primary_chain_id: string }[]>>()
      .mockResolvedValue([{ primary_chain_id: '0x1' }]),
  },
}));

vi.mock('@libs/chain', () => ({
  ChainContextRegistry: vi.fn(),
  parseChainConfigFromEnv: vi.fn(),
  readConfirmedHead: vi.fn(),
}));

vi.mock('@libs/db', () => ({
  pgDb: {},
  SeenLogRepository: vi.fn().mockImplementation(function () {
    return seenLog;
  }),
  DaoSourceRepository: vi.fn().mockImplementation(function () {
    return daoSourceRepo;
  }),
}));

const CHAIN_CFG = {
  chainId: '0x1',
  name: 'ethereum',
  headLag: 12,
  providers: [],
};

function makeRegistry(): ChainContextRegistry {
  return {
    getOrCreate: vi.fn().mockResolvedValue({ client: {} }),
  } as unknown as ChainContextRegistry;
}

function makeSvc(registry = makeRegistry()) {
  return new SeenLogPruneService(registry);
}

async function prune(svc: SeenLogPruneService) {
  await (svc as unknown as { prune(): Promise<void> }).prune();
}

describe('SeenLogPruneService', () => {
  beforeEach(() => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG] as never);
    vi.mocked(readConfirmedHead).mockResolvedValue(1000n);
    seenLog.pruneBelow.mockResolvedValue(0);
    daoSourceRepo.findAll.mockResolvedValue([{ primary_chain_id: '0x1' }]);
    delete process.env['SEEN_LOG_PRUNE_MARGIN_BLOCKS'];
    delete process.env['SEEN_LOG_PRUNE_EVERY_N_TICKS'];
    delete process.env['EVENT_POLL_INTERVAL_MS'];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('prune()', () => {
    it('calls pruneBelow with correct horizon (confirmedHead − 2×headLag − headLag)', async () => {
      await prune(makeSvc());

      // horizon = 1000 - 2*12 - 12 = 964
      expect(seenLog.pruneBelow).toHaveBeenCalledWith('0x1', 964n);
    });

    it('uses custom margin from SEEN_LOG_PRUNE_MARGIN_BLOCKS env var', async () => {
      process.env['SEEN_LOG_PRUNE_MARGIN_BLOCKS'] = '50';

      await prune(makeSvc());

      // horizon = 1000 - 24 - 50 = 926
      expect(seenLog.pruneBelow).toHaveBeenCalledWith('0x1', 926n);
    });

    it('skips pruning when horizon is zero or negative', async () => {
      vi.mocked(readConfirmedHead).mockResolvedValue(10n); // too low — horizon goes negative

      await prune(makeSvc());

      expect(seenLog.pruneBelow).not.toHaveBeenCalled();
    });

    it('deduplicates chains — two sources on the same chain only prune once', async () => {
      daoSourceRepo.findAll.mockResolvedValue([
        { primary_chain_id: '0x1' },
        { primary_chain_id: '0x1' },
      ]);

      await prune(makeSvc());

      expect(seenLog.pruneBelow).toHaveBeenCalledTimes(1);
    });

    it('skips sources whose chain is not in CHAIN_CONFIG', async () => {
      daoSourceRepo.findAll.mockResolvedValue([{ primary_chain_id: '0x89' }]);

      await prune(makeSvc());

      expect(seenLog.pruneBelow).not.toHaveBeenCalled();
    });

    it('continues to next chain if one chain fails', async () => {
      vi.mocked(parseChainConfigFromEnv).mockReturnValue([
        { ...CHAIN_CFG, chainId: '0x1' },
        { ...CHAIN_CFG, chainId: '0x89' },
      ] as never);
      daoSourceRepo.findAll.mockResolvedValue([
        { primary_chain_id: '0x1' },
        { primary_chain_id: '0x89' },
      ]);
      const registry = {
        getOrCreate: vi
          .fn()
          .mockRejectedValueOnce(new Error('rpc down'))
          .mockResolvedValueOnce({ client: {} }),
      } as unknown as ChainContextRegistry;

      await prune(makeSvc(registry));

      expect(seenLog.pruneBelow).toHaveBeenCalledWith('0x89', 964n);
    });

    it('handles outer errors (daoSourceRepo failure) without throwing', async () => {
      daoSourceRepo.findAll.mockRejectedValue(new Error('db down'));

      await expect(prune(makeSvc())).resolves.toBeUndefined();
    });
  });

  describe('onApplicationBootstrap / onApplicationShutdown', () => {
    it('sets interval at N×pollMs and clears it on shutdown', async () => {
      vi.useFakeTimers();
      process.env['SEEN_LOG_PRUNE_EVERY_N_TICKS'] = '5';
      process.env['EVENT_POLL_INTERVAL_MS'] = '200';

      const svc = makeSvc();
      await svc.onApplicationBootstrap();

      expect(seenLog.pruneBelow).not.toHaveBeenCalled();

      // Advance 5×200ms = 1000ms → one tick fires
      await vi.advanceTimersByTimeAsync(1000);
      expect(seenLog.pruneBelow).toHaveBeenCalledTimes(1);

      await svc.onApplicationShutdown();

      // No further ticks after shutdown
      await vi.advanceTimersByTimeAsync(2000);
      expect(seenLog.pruneBelow).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });
});
