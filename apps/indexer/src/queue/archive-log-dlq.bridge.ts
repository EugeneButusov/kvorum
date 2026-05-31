import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { DlqRepository } from '@libs/db';
import type { RawLogJob } from '@sources/core';
import { ArchiveProducerProvider } from './archive-producer.provider';
import { ARCHIVE_LOG_DLQ_QUEUE } from './queue-names';

/** Drains pg-boss dead-lettered jobs into ingestion_dlq so the dashboard and admin-cli surface them. */
@Injectable()
export class ArchiveLogDlqBridge implements OnApplicationBootstrap {
  private readonly logger = new Logger('ArchiveLogDlqBridge');

  constructor(
    private readonly archiveProducer: ArchiveProducerProvider,
    private readonly dlqRepo: DlqRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.archiveProducer.whenBossReady();
    const boss = this.archiveProducer.getBoss();
    await boss.work(ARCHIVE_LOG_DLQ_QUEUE, { localConcurrency: 1 }, async (jobs) => {
      for (const job of jobs) {
        const raw = job.data as RawLogJob;
        const now = new Date();
        await this.dlqRepo.insert({
          stage: 'archive_log',
          source: raw.chainId,
          payload: {
            raw: { topics: raw.topics, data: raw.data },
            block_number: raw.blockNumber,
            address: raw.address,
          },
          error: { name: 'PgBossDeadLettered', message: `job ${job.id} exhausted retries` },
          retries: 0,
          first_seen_at: now,
          last_attempt_at: now,
          archive_source_type: null,
          archive_chain_id: raw.chainId,
          archive_tx_hash: raw.txHash,
          archive_log_index: raw.logIndex,
          archive_block_hash: raw.blockHash,
        });
        this.logger.warn('archive_log_dead_lettered', { jobId: job.id, txHash: raw.txHash });
      }
    });
    this.logger.log('archive_log_dlq_bridge_registered');
  }
}
