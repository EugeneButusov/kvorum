import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ChainContextRegistry, parseChainConfigFromEnv, readConfirmedHead } from '@libs/chain';
import { pgDb, SeenLogRepository, DaoSourceRepository } from '@libs/db';

// How many poll ticks between prune runs (configurable via SEEN_LOG_PRUNE_EVERY_N_TICKS).
const DEFAULT_N = 10;
// Poll interval in ms (must match the event poller; default 12s).
const DEFAULT_POLL_INTERVAL_MS = 12_000;

@Injectable()
export class SeenLogPruneService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('SeenLogPrune');
  private readonly seenLog = new SeenLogRepository(pgDb);
  private readonly daoSourceRepo = new DaoSourceRepository(pgDb);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly registry: ChainContextRegistry) {}

  async onApplicationBootstrap(): Promise<void> {
    const n = parseInt(process.env['SEEN_LOG_PRUNE_EVERY_N_TICKS'] ?? String(DEFAULT_N), 10);
    const pollMs = parseInt(
      process.env['EVENT_POLL_INTERVAL_MS'] ?? String(DEFAULT_POLL_INTERVAL_MS),
      10,
    );
    const intervalMs = n * pollMs;
    this.interval = setInterval(() => void this.prune(), intervalMs);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async prune(): Promise<void> {
    try {
      const chains = parseChainConfigFromEnv(process.env);
      const sources = await this.daoSourceRepo.findAll();
      const processedChainIds = new Set<string>();

      for (const src of sources) {
        if (processedChainIds.has(src.primary_chain_id)) continue;
        const chainCfg = chains.find((c) => c.chainId === src.primary_chain_id);
        if (!chainCfg) continue;

        try {
          const chainCtx = await this.registry.getOrCreate(chainCfg);
          const confirmedHead = await readConfirmedHead(chainCtx.client, chainCfg);
          const windowSize = BigInt(chainCfg.headLag) * 2n;
          const margin = BigInt(process.env['SEEN_LOG_PRUNE_MARGIN_BLOCKS'] ?? chainCfg.headLag);
          const horizon = confirmedHead - windowSize - margin;

          if (horizon <= 0n) continue;

          const deleted = await this.seenLog.pruneBelow(chainCfg.chainId, horizon);
          if (deleted > 0) {
            this.logger.debug('seen_log_pruned', {
              chainId: chainCfg.chainId,
              horizon: horizon.toString(),
              deleted,
            });
          }
          processedChainIds.add(src.primary_chain_id);
        } catch (err) {
          this.logger.warn('seen_log_prune_chain_failed', {
            chainId: src.primary_chain_id,
            error: String(err),
          });
        }
      }
    } catch (err) {
      this.logger.error('seen_log_prune_failed', String(err));
    }
  }
}
