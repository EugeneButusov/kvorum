import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import {
  CompoundProposalRepository,
  CompoundReconcileDriver,
  CompoundStateReconciler,
  type ReconcileBound,
} from '@sources/compound';
import { buildDriverMetrics } from './state-reconciler-metrics';
import { toChainLogger } from './utils/nest-logger-adapter';

interface IChainContext {
  headTracker: {
    onHead(listener: (head: { blockNumber: bigint }) => void | Promise<void>): () => void;
  };
  chainCfg: { chainId: string; reorgHorizon: number };
  client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
}

interface IChainContextRegistry {
  allActive(): IChainContext[];
}

@Injectable()
export class CompoundReconcileService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly driver: CompoundReconcileDriver;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    @Inject('ChainContextRegistry') private readonly registry: IChainContextRegistry,
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
