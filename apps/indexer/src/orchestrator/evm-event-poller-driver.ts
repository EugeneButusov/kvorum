import { EventPoller, FailoverRpcClient } from '@libs/chain';
import type { ChainConfig, Logger } from '@libs/chain';
import type { IngestSpec, SourceContext } from '@sources/core';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';

interface ClientRef {
  client: FailoverRpcClient;
  refCount: number;
}

export class EvmEventPollerDriver implements FetchDriver<'evm-event-poller'> {
  readonly kind = 'evm-event-poller' as const;

  private readonly clients = new Map<string, ClientRef>();
  private readonly logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  async start(
    spec: Extract<IngestSpec, { kind: 'evm-event-poller' }>,
    ctx: SourceContext,
    chainCfg: ChainConfig,
  ): Promise<FetchDriverHandle> {
    let ref = this.clients.get(chainCfg.chainId);
    if (!ref) {
      const client = new FailoverRpcClient(chainCfg);
      await client.start();
      ref = { client, refCount: 0 };
      this.clients.set(chainCfg.chainId, ref);
    }
    ref.refCount++;
    const clientRef = ref;

    const poller = new EventPoller({
      rpcClient: clientRef.client,
      chainId: ctx.chainId,
      chainName: chainCfg.name,
      reorgHorizon: chainCfg.reorgHorizon,
      sourceType: ctx.sourceType,
      daoSourceLabel: ctx.daoSourceId,
      filter: spec.filter,
      pollIntervalMs: 12_000,
      logger: this.logger,
    });

    poller.onEvents(spec.listener);
    await poller.start();

    return {
      stop: async () => {
        await poller.stop();
        clientRef.refCount--;
        if (clientRef.refCount === 0) {
          this.clients.delete(chainCfg.chainId);
          await clientRef.client.stop();
        }
      },
    };
  }
}
