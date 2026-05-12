import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { chainMetrics } from '@libs/chain';
import { ConfirmationRepository } from '@libs/db';
import type { ChainContextRegistry } from './chain-context-registry';

const SWEEP_INTERVAL_MS = 30_000;

@Injectable()
export class PromotionSweepService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PromotionSweep');
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registry: ChainContextRegistry,
    private readonly confirmationRepo: ConfirmationRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    void this.tick();
    this.interval = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick(): Promise<void> {
    for (const ctx of this.registry.allActive()) {
      const head = ctx.headTracker.getLastHead();
      if (head === null) {
        this.logger.debug('sweep_skip_no_head', { chain: ctx.chainCfg.name });
        continue;
      }

      const horizon = BigInt(ctx.chainCfg.reorgHorizon);
      if (head.blockNumber < horizon) {
        continue;
      }
      const threshold = head.blockNumber - horizon;

      const sweepStartMs = Date.now();
      let promotedCount = 0;
      try {
        promotedCount = await this.confirmationRepo.promotePending(ctx.chainCfg.chainId, threshold);
      } catch (err) {
        this.logger.warn('sweep_failed', {
          chain: ctx.chainCfg.name,
          chain_id: ctx.chainCfg.chainId,
          error: String(err),
        });
        continue;
      } finally {
        chainMetrics.promotionSweepDuration.record((Date.now() - sweepStartMs) / 1000, {
          chain_id: ctx.chainCfg.chainId,
        });
      }

      if (promotedCount > 0) {
        this.logger.log('sweep_promoted', {
          chain: ctx.chainCfg.name,
          chain_id: ctx.chainCfg.chainId,
          threshold_block_number: threshold.toString(),
          promoted_count: promotedCount,
        });
      }
    }
  }
}
