import { Injectable } from '@nestjs/common';
import { EventPoller } from '@libs/chain';
import type { IngestSpec, SourceContext } from '@sources/core';
import { ChainContextRegistry } from './chain-context-registry';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';

@Injectable()
export class EvmEventPollerDriver implements FetchDriver<'evm-event-poller'> {
  readonly kind = 'evm-event-poller' as const;

  constructor(private readonly registry: ChainContextRegistry) {}

  async start(
    spec: Extract<IngestSpec, { kind: 'evm-event-poller' }>,
    ctx: SourceContext,
    chainCfg: Parameters<ChainContextRegistry['lease']>[0],
  ): Promise<FetchDriverHandle> {
    const lease = await this.registry.lease(chainCfg);

    const poller = new EventPoller({
      rpcClient: lease.client,
      chainId: ctx.chainId,
      chainName: chainCfg.name,
      reorgHorizon: chainCfg.reorgHorizon,
      sourceType: ctx.sourceType,
      daoSourceLabel: ctx.daoSourceId,
      filter: spec.filter,
      pollIntervalMs: 12_000,
    });

    poller.onEvents(spec.listener);
    await poller.start();

    return {
      stop: async () => {
        await poller.stop();
        await lease.release();
      },
    };
  }
}
