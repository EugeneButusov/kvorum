import { Injectable } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import type { IngestSpec, SourceContext } from '@sources/core';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';

@Injectable()
export class EvmBlockHeadPollerDriver implements FetchDriver<'evm-block-head-poller'> {
  readonly kind = 'evm-block-head-poller' as const;

  constructor(private readonly registry: ChainContextRegistry) {}

  async start(
    spec: Extract<IngestSpec, { kind: 'evm-block-head-poller' }>,
    _ctx: SourceContext,
    chainCfg: Parameters<ChainContextRegistry['getOrCreate']>[0],
    _opts?: {
      onFirstTickComplete?: (head: bigint) => void;
    },
  ): Promise<FetchDriverHandle> {
    const chainCtx = await this.registry.getOrCreate(chainCfg);

    const unsub = chainCtx.headTracker.onHead(spec.listener);

    return {
      stop: async () => {
        unsub();
      },
    };
  }
}
