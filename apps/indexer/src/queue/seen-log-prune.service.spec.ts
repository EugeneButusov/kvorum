import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainContextRegistry } from '@libs/chain';
import { parseChainConfigFromEnv, readConfirmedHead } from '@libs/chain';
import { SeenLogPruneService } from './seen-log-prune.service';

vi.mock('@libs/chain', () => ({
  ChainContextRegistry: vi.fn(),
  parseChainConfigFromEnv: vi.fn(),
  readConfirmedHead: vi.fn(),
}));

vi.mock('@libs/db', () => ({
  pgDb: {},
  SeenLogRepository: vi.fn(),
  DaoSourceRepository: vi.fn(),
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

function makeSeenLog() {
  return { pruneBelow: vi.fn().mockResolvedValue(0) };
}

function makeDaoSourceRepo(sources: { primary_chain_id: string }[]) {
  return { findAll: vi.fn().mockResolvedValue(sources) };
}

function makeSvc(registry = makeRegistry()) {
  return new SeenLogPruneService(registry);
}

function overrideDeps(
  svc: SeenLogPruneService,
  {
    seenLog = makeSeenLog(),
    daoSourceRepo = makeDaoSourceRepo([{ primary_chain_id: '0x1' }]),
  } = {},
) {
  Object.assign(svc, { seenLog, daoSourceRepo });
  return { seenLog, daoSourceRepo };
}

async function prune(svc: SeenLogPruneService) {
  await (svc as unknown as { prune: () => Promise<void> }).prune();
}

describe('SeenLogPruneService', () => {
  beforeEach(() => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG] as never);
    vi.mocked(readConfirmedHead).mockResolvedValue(1000n);
    delete process.env['SEEN_LOG_PRUNE_MARGIN_BLOCKS'];
    delete process.env['SEEN_LOG_PRUNE_EVERY_N_TICKS'];
    delete process.env['EVENT_POLL_INTERVAL_MS'];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('prune()', () => {
    it('calls pruneBelow with correct horizon (confirmedHead − 2×headLag − headLag)', async () => {
      const svc = makeSvc();
      const { seenLog } = overrideDeps(svc);

      await prune(svc);

      // horizon = 1000 - 2*12 - 12 = 964
      expect(seenLog.pruneBelow).toHaveBeenCalledWith('0x1', 964n);
    });

    it('uses custom margin from SEEN_LOG_PRUNE_MARGIN_BLOCKS env var', async () => {
      process.env['SEEN_LOG_PRUNE_MARGIN_BLOCKS'] = '50';
      const svc = makeSvc();
      const { seenLog } = overrideDeps(svc);

      await prune(svc);

      // horizon = 1000 - 24 - 50 = 926
      expect(seenLog.pruneBelow).toHaveBeenCalledWith('0x1', 926n);
    });

    it('skips pruning when horizon is zero or negative', async () => {
      vi.mocked(readConfirmedHead).mockResolvedValue(10n); // too low — horizon goes negative
      const svc = makeSvc();
      const { seenLog } = overrideDeps(svc);

      await prune(svc);

      expect(seenLog.pruneBelow).not.toHaveBeenCalled();
    });

    it('deduplicates chains — two sources on the same chain only prune once', async () => {
      const svc = makeSvc();
      const { seenLog } = overrideDeps(svc, {
        daoSourceRepo: makeDaoSourceRepo([
          { primary_chain_id: '0x1' },
          { primary_chain_id: '0x1' },
        ]),
      });

      await prune(svc);

      expect(seenLog.pruneBelow).toHaveBeenCalledTimes(1);
    });

    it('skips sources whose chain is not in CHAIN_CONFIG', async () => {
      const svc = makeSvc();
      const { seenLog } = overrideDeps(svc, {
        daoSourceRepo: makeDaoSourceRepo([{ primary_chain_id: '0x89' }]),
      });

      await prune(svc);

      expect(seenLog.pruneBelow).not.toHaveBeenCalled();
    });

    it('continues to next chain if one chain fails', async () => {
      vi.mocked(parseChainConfigFromEnv).mockReturnValue([
        { ...CHAIN_CFG, chainId: '0x1' },
        { ...CHAIN_CFG, chainId: '0x89' },
      ] as never);
      const registry = {
        getOrCreate: vi
          .fn()
          .mockRejectedValueOnce(new Error('rpc down'))
          .mockResolvedValueOnce({ client: {} }),
      } as unknown as ChainContextRegistry;
      const svc = makeSvc(registry);
      const { seenLog } = overrideDeps(svc, {
        daoSourceRepo: makeDaoSourceRepo([
          { primary_chain_id: '0x1' },
          { primary_chain_id: '0x89' },
        ]),
      });

      await prune(svc);

      expect(seenLog.pruneBelow).toHaveBeenCalledWith('0x89', 964n);
    });

    it('handles outer errors (daoSourceRepo failure) without throwing', async () => {
      const svc = makeSvc();
      overrideDeps(svc, {
        daoSourceRepo: { findAll: vi.fn().mockRejectedValue(new Error('db down')) },
      });

      await expect(prune(svc)).resolves.toBeUndefined();
    });
  });

  describe('onApplicationBootstrap / onApplicationShutdown', () => {
    it('sets interval at N×pollMs and clears it on shutdown', async () => {
      vi.useFakeTimers();
      process.env['SEEN_LOG_PRUNE_EVERY_N_TICKS'] = '5';
      process.env['EVENT_POLL_INTERVAL_MS'] = '200';

      const svc = makeSvc();
      const { seenLog } = overrideDeps(svc);

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
