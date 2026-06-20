import { Injectable } from '@nestjs/common';
import { pgDb, OffChainCursorRepository } from '@libs/db';
import type { JsonValue } from '@libs/domain';
import type { PollItem, QueueProducerPort, SourceContext } from '@sources/core';
import { JobQueueService } from '../queue/job-queue.service';
import type { OffChainArchiveJob } from '../queue/off-chain-archive.types';
import { OFF_CHAIN_ARCHIVE_QUEUE } from '../queue/queue-names';

/** Real QueueProducerPort (Z2) — replaces the Z0 no-op stub. `commitTick` enqueues the
 *  tick's items AND advances the persisted cursor in ONE PG transaction (all-or-nothing),
 *  so the cursor advances only if the jobs are durably enqueued. A crash re-fetches
 *  (idempotent at the consumer via external_id/content_hash) rather than skips. */
@Injectable()
export class OffChainQueueProducer implements QueueProducerPort {
  constructor(
    private readonly jobQueue: JobQueueService,
    private readonly cursorRepo: OffChainCursorRepository,
  ) {}

  async loadCursor(source: SourceContext): Promise<JsonValue | null> {
    return this.cursorRepo.load(source.daoSourceId);
  }

  async commitTick(
    source: SourceContext,
    items: readonly PollItem[],
    nextCursor: JsonValue | null,
  ): Promise<void> {
    await pgDb.transaction().execute(async (trx) => {
      for (const item of items) {
        const job: OffChainArchiveJob = {
          daoSourceId: source.daoSourceId,
          sourceType: source.sourceType,
          externalId: item.externalId,
          eventType: item.eventType,
          contentHash: item.contentHash,
          ordinal: item.ordinal,
          payload: item.payload,
        };
        await this.jobQueue.sendInTx(OFF_CHAIN_ARCHIVE_QUEUE, job, trx);
      }
      await this.cursorRepo.upsert(trx, source.daoSourceId, nextCursor);
    });
  }
}
