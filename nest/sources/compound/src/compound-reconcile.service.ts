import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import {
  CompoundProposalRepository,
  CompoundReconcileDriver,
  CompoundStateReconciler,
  type ReconcileBound,
} from '@sources/compound';
import { buildDriverMetrics } from './state-reconciler-metrics';
import { toChainLogger } from './utils/nest-logger-adapter';

@Injectable()
export class CompoundReconcileService implements OnApplicationBootstrap, OnApplicationShutdown {
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

  async onApplicationBootstrap(): Promise<void> {
    for (const ctx of this.registry.allActive()) {
      const unsub = ctx.headTracker.onHead((head) => {
        const horizon = BigInt(ctx.chainCfg.reorgHorizon);
        if (head.blockNumber < horizon) return;
        const bound: ReconcileBound = {
          chainId: ctx.chainCfg.chainId,
          confirmedThresholdBlock: (head.blockNumber - horizon).toString(),
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
