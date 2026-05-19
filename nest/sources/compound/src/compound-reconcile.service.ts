import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import {
  SUPPORTED_CHAIN_IDS,
  CompoundProposalRepository,
  CompoundReconcileDriver,
  CompoundStateReconciler,
  type ReconcileBound,
} from '@sources/compound';
import { buildDriverMetrics } from './state-reconciler-metrics';
import { toChainLogger } from './utils/nest-logger-adapter';

@Injectable()
export class CompoundReconcileService implements OnApplicationShutdown {
  private readonly driver: CompoundReconcileDriver;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly registry: ChainContextRegistry,
    proposals: CompoundProposalRepository,
  ) {
    this.driver = new CompoundReconcileDriver(
      new CompoundStateReconciler(toChainLogger(new Logger('CompoundStateReconciler'))),
      proposals,
      buildDriverMetrics(),
      toChainLogger(new Logger('CompoundReconcile')),
    );
  }

  startListening(): void {
    const recheckGapSeconds = Number(
      process.env['COMPOUND_STATE_RECONCILE_RECHECK_GAP_SECONDS'] ?? 7_200,
    );
    for (const ctx of this.registry.allActive()) {
      if (
        !SUPPORTED_CHAIN_IDS.includes(ctx.chainCfg.chainId as (typeof SUPPORTED_CHAIN_IDS)[number])
      )
        continue;
      const blocksPerMinute = ctx.chainCfg.blocksPerMinute ?? 5;
      const recheckGapBlocks = Math.ceil((recheckGapSeconds / 60) * blocksPerMinute);
      const unsub = ctx.headTracker.onHead((head) => {
        const horizon = BigInt(ctx.chainCfg.reorgHorizon);
        if (head.blockNumber < horizon) return;
        const bound: ReconcileBound = {
          chainId: ctx.chainCfg.chainId,
          confirmedThresholdBlock: (head.blockNumber - horizon).toString(),
          recheckGapBlocks,
          client: ctx.client,
        };
        void this.driver.onConfirmedHeads([bound]);
      });
      this.unsubscribers.push(unsub);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
  }
}
