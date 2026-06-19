import { Logger } from '@nestjs/common';
import type { PollEnqueuePort } from '@sources/core';

/** Z0 stub: no-op enqueue that warns on every call.
 *  Replace with a real pg-boss enqueue in Z2 once external_id idempotency (Z1)
 *  and cursor persistence (Z2) are in place. */
export function makePollEnqueueStub(): PollEnqueuePort {
  const logger = new Logger('PollEnqueueStub');
  return {
    async enqueue(source, item): Promise<void> {
      logger.warn('poll_enqueue_stub_drop — real enqueue arrives in Z2', {
        sourceType: source.sourceType,
        externalId: item.externalId,
      });
    },
  };
}
