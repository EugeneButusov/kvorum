import { Injectable, Logger } from '@nestjs/common';
import type { Logger as ChainLogger } from '@libs/chain';
import { EventPoller, ChainContextRegistry } from '@libs/chain';
import { DaoSourceRepository } from '@libs/db';
import type { IngestSpec, SourceContext } from '@sources/core';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';

@Injectable()
export class EvmEventPollerDriver implements FetchDriver<'evm-event-poller'> {
  readonly kind = 'evm-event-poller' as const;
  private readonly logger = new Logger('EventPoller');
  private readonly chainLogger: ChainLogger = {
    debug: (msg, ...args) => this.logger.debug(msg, ...args),
    info: (msg, ...args) => this.logger.log(msg, ...args),
    warn: (msg, ...args) => this.logger.warn(msg, ...args),
    error: (msg, ...args) => this.logger.error(msg, ...args),
  };

  constructor(
    private readonly registry: ChainContextRegistry,
    private readonly daoSourceRepo: DaoSourceRepository,
  ) {}

  async start(
    spec: Extract<IngestSpec, { kind: 'evm-event-poller' }>,
    ctx: SourceContext,
    chainCfg: Parameters<ChainContextRegistry['getOrCreate']>[0],
  ): Promise<FetchDriverHandle> {
    const chainCtx = await this.registry.getOrCreate(chainCfg);

    const pollIntervalMs =
      chainCfg.eventPollIntervalMs ?? Number(process.env['EVENT_POLL_INTERVAL_MS'] ?? 12_000);

    const poller = new EventPoller({
      rpcClient: chainCtx.client,
      chainId: ctx.chainId,
      chainName: chainCfg.name,
      reorgHorizon: chainCfg.reorgHorizon,
      sourceType: ctx.sourceType,
      daoSourceLabel: ctx.daoSourceId,
      filter: spec.filter,
      pollIntervalMs,
      onTickComplete: (head) => this.daoSourceRepo.updateLiveHead(ctx.daoSourceId, head),
      logger: this.chainLogger,
    });

    poller.onEvents(spec.listener);
    await poller.start();

    return {
      stop: async () => {
        await poller.stop();
      },
    };
  }
}
