import { Injectable, Inject } from '@nestjs/common';
import type { IngestSpec, SourceContext, QueueProducerPort } from '@sources/core';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';
import { PollSourcePoller } from './poll-source-poller';
import { QUEUE_PRODUCER_PORT } from './tokens';

@Injectable()
export class PollFetchDriver implements FetchDriver<'poll'> {
  readonly kind = 'poll' as const;

  constructor(@Inject(QUEUE_PRODUCER_PORT) private readonly enqueuePort: QueueProducerPort) {}

  async start(
    spec: Extract<IngestSpec, { kind: 'poll' }>,
    ctx: SourceContext,
  ): Promise<FetchDriverHandle> {
    const poller = new PollSourcePoller({
      source: ctx,
      listener: spec.listener,
      enqueuePort: this.enqueuePort,
    });
    await poller.start();
    return {
      stop: () => poller.stop(),
    };
  }
}
