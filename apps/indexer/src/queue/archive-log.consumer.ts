import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { chainMetrics } from '@libs/chain';
import { DlqRepository } from '@libs/db';
import type { NewIngestionDlq } from '@libs/db';
import { DecodeError } from '@sources/compound';
import type { ArchiveConsumeFn, ArchiveConsumeContext, RawLogJob } from '@sources/core';
import { ARCHIVE_LOG_QUEUE } from './queue-names';
import { QUEUE_WORKER_PORT } from './queue-worker-port';
import type { QueueWorkerPort } from './queue-worker-port';
import { SourceResolver } from './source-resolver';

export const ARCHIVE_CONSUMER_FNS = 'ARCHIVE_CONSUMER_FNS';

@Injectable()
export class ArchiveLogConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger('ArchiveLogConsumer');

  constructor(
    @Inject(QUEUE_WORKER_PORT) private readonly queue: QueueWorkerPort,
    private readonly resolver: SourceResolver,
    @Inject(ARCHIVE_CONSUMER_FNS)
    private readonly consumers: Map<string, ArchiveConsumeFn>,
    private readonly dlqRepo: DlqRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work<RawLogJob>(ARCHIVE_LOG_QUEUE, { localConcurrency: 1 }, async (jobs) => {
      for (const job of jobs) {
        await this.handle(job.data);
      }
    });
    this.logger.log('archive_log_consumer_registered');
  }

  private async handle(raw: RawLogJob): Promise<void> {
    // Resolve address → source; rebuild once on miss before dead-lettering (R-EXEC-S1).
    let ctx = this.resolver.resolve(raw.chainId, raw.address);
    if (!ctx) {
      await this.resolver.rebuild();
      ctx = this.resolver.resolve(raw.chainId, raw.address);
    }

    if (!ctx) {
      await this.dlqRepo.insert(
        makeDlqRow('archive_unmapped', raw, null, new Error(`address not mapped: ${raw.address}`)),
      );
      chainMetrics.archiveLogConsumer.add(1, { source: raw.chainId, result: 'unmapped' });
      return; // ack — config anomaly; don't burn retries
    }

    const consume = this.consumers.get(ctx.sourceType);
    if (!consume) {
      await this.dlqRepo.insert(
        makeDlqRow(
          'archive_unmapped',
          raw,
          ctx,
          new Error(`no consumer for source_type: ${ctx.sourceType}`),
        ),
      );
      chainMetrics.archiveLogConsumer.add(1, { source: ctx.sourceLabel, result: 'unmapped' });
      return;
    }

    try {
      await consume(ctx, raw);
      chainMetrics.archiveLogConsumer.add(1, { source: ctx.sourceLabel, result: 'inserted' });
    } catch (err) {
      if (err instanceof DecodeError) {
        await this.dlqRepo.insert(makeDlqRow('archive_decode', raw, ctx, err));
        chainMetrics.archiveLogConsumer.add(1, { source: ctx.sourceLabel, result: 'decode_dlq' });
        this.logger.warn('archive_decode_dlq', {
          txHash: raw.txHash,
          logIndex: raw.logIndex,
          reason: err.reason,
        });
        return; // ack — decode is deterministic; don't burn retries
      }
      // Transient (CH/PG) → throw → retry → deadLetter after retryLimit.
      chainMetrics.archiveLogConsumer.add(1, { source: ctx.sourceLabel, result: 'transient_dlq' });
      throw err;
    }
  }
}

function makeDlqRow(
  stage: 'archive_decode' | 'archive_unmapped',
  raw: RawLogJob,
  ctx: ArchiveConsumeContext | null,
  err: Error,
): NewIngestionDlq {
  const now = new Date();
  return {
    stage,
    source: ctx?.sourceLabel ?? raw.chainId,
    payload: {
      raw: { topics: raw.topics, data: raw.data },
      block_number: raw.blockNumber,
      address: raw.address,
      reason: err instanceof DecodeError ? err.reason : err.message,
    },
    error: { name: err.name, message: err.message },
    retries: 0,
    first_seen_at: now,
    last_attempt_at: now,
    archive_source_type: ctx?.sourceType ?? null,
    archive_chain_id: raw.chainId,
    archive_tx_hash: raw.txHash,
    archive_log_index: raw.logIndex,
    archive_block_hash: raw.blockHash,
  };
}
