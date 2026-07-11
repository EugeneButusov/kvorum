import type { AiJob } from '../queue/ai-queue-names';

/** A per-feature job handler. CONTRACT: must be idempotent by content hash — the same job may be
 *  enqueued more than once (the #432 content-hash cache is the idempotency boundary). Registered
 *  by M5-2 feature modules; empty in M5-1.4. */
export interface AiFeatureHandler {
  handle(job: AiJob): Promise<void>;
}
