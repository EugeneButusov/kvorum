import { Injectable } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import type { IngestSpec, SourceContext, BlockHeadArgs } from '@sources/core';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';

@Injectable()
export class EvmBlockHeadPollerDriver implements FetchDriver<'evm-block-head-poller'> {
  readonly kind = 'evm-block-head-poller' as const;

  constructor(private readonly registry: ChainContextRegistry) {}

  async start(
    spec: Extract<IngestSpec, { kind: 'evm-block-head-poller' }>,
    _ctx: SourceContext,
    chainCfg: Parameters<ChainContextRegistry['getOrCreate']>[0],
  ): Promise<FetchDriverHandle> {
    const chainCtx = await this.registry.getOrCreate(chainCfg);
    const blocksPerMinute = chainCfg.blocksPerMinute ?? 5;
    const recheckGapBlocks = Math.ceil((spec.recheckGapSeconds / 60) * blocksPerMinute);

    const unsub = chainCtx.headTracker.onHead((head) => {
      const horizon = BigInt(chainCfg.reorgHorizon);
      if (head.blockNumber < horizon) return;
      const args: BlockHeadArgs = {
        chainId: chainCfg.chainId,
        confirmedThresholdBlock: head.blockNumber - horizon,
        recheckGapBlocks,
        client: chainCtx.client,
      };
      spec.listener(args);
    });

    return {
      stop: async () => {
        unsub();
      },
    };
  }
}
