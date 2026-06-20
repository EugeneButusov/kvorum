import { Logger } from '@nestjs/common';
import type { QueueProducerPort } from '@sources/core';

/** No-op stub bound until the real pg-boss enqueue lands.
 *  The real port must not be bound until archive_event gains external_id idempotency
 *  and cursor persistence is in place — binding earlier causes a duplicate-enqueue flood
 *  on every restart (in-memory cursor resets to null). */
export function makeQueueProducerStub(): QueueProducerPort {
  const logger = new Logger('QueueProducerStub');
  return {
    async enqueue(source, item): Promise<void> {
      logger.warn('queue_producer_stub_drop — real enqueue not yet bound', {
        sourceType: source.sourceType,
        externalId: item.externalId,
      });
    },
  };
}
