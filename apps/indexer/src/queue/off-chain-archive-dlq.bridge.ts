import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { DlqRepository } from '@libs/db';
import type { OffChainArchiveJob } from './off-chain-archive.types';
import { OFF_CHAIN_ARCHIVE_DLQ_QUEUE } from './queue-names';
import { QUEUE_WORKER_PORT } from './queue-worker-port';
import type { QueueWorkerPort } from './queue-worker-port';

/** Drains dead-lettered off-chain archive jobs into ingestion_dlq so the dashboard and
 *  admin-cli surface them (mirrors ArchiveLogDlqBridge). */
@Injectable()
export class OffChainArchiveDlqBridge implements OnApplicationBootstrap {
  private readonly logger = new Logger('OffChainArchiveDlqBridge');

  constructor(
    @Inject(QUEUE_WORKER_PORT) private readonly queue: QueueWorkerPort,
    private readonly dlqRepo: DlqRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work<OffChainArchiveJob>(
      OFF_CHAIN_ARCHIVE_DLQ_QUEUE,
      { localConcurrency: 1 },
      async (jobs) => {
        for (const job of jobs) {
          const j = job.data;
          const now = new Date();
          await this.dlqRepo.insert({
            stage: 'off_chain_archive',
            source: j.sourceType,
            payload: {
              external_id: j.externalId,
              dao_source_id: j.daoSourceId,
              event_type: j.eventType,
              content_hash: j.contentHash,
              raw: j.payload,
            },
            error: { name: 'DeadLettered', message: `job ${job.id} exhausted retries` },
            retries: 0,
            first_seen_at: now,
            last_attempt_at: now,
            archive_source_type: j.sourceType,
            archive_chain_id: 'off-chain',
            archive_tx_hash: null,
            archive_log_index: null,
            archive_block_hash: null,
          });
          this.logger.warn('off_chain_archive_dead_lettered', {
            jobId: job.id,
            externalId: j.externalId,
          });
        }
      },
    );
    this.logger.log('off_chain_archive_dlq_bridge_registered');
  }
}
