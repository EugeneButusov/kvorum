import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ChainContextRegistry, chainMetrics } from '@libs/chain';
import { ConfirmationRepository } from '@libs/db';

@Injectable()
export class PromotionSweepService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PromotionSweep');
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registry: ChainContextRegistry,
    private readonly confirmationRepo: ConfirmationRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const firstChainMs = this.registry.allActive()[0]?.chainCfg.sweepIntervalMs;
    const sweepIntervalMs = firstChainMs ?? Number(process.env['SWEEP_INTERVAL_MS'] ?? 30_000);
    void this.tick();
    this.interval = setInterval(() => void this.tick(), sweepIntervalMs);
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
