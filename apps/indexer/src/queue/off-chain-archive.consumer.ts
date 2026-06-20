import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { chainMetrics } from '@libs/chain';
import { ArchiveEventRepository, DaoSourceRepository, DlqRepository } from '@libs/db';
import type { NewIngestionDlq } from '@libs/db';
import type { ArchiveConsumeContext, OffChainArchiveWriteFn } from '@sources/core';
import type { OffChainArchiveJob } from './off-chain-archive.types';
import { OFF_CHAIN_ARCHIVE_QUEUE } from './queue-names';
import { QUEUE_WORKER_PORT } from './queue-worker-port';
import type { QueueWorkerPort } from './queue-worker-port';

/** Map of source_type → per-source CH writer (the off-chain twin of ARCHIVE_CONSUMER_FNS). */
export const OFF_CHAIN_ARCHIVE_WRITERS = 'OFF_CHAIN_ARCHIVE_WRITERS';

const OFF_CHAIN_DLQ_STAGE = 'off_chain_archive';

/**
 * Off-chain archive consumer (ADR-071, Z2). Resolves the source by daoSourceId (not
 * chain+address), skips ABI decode, and applies mutable-latest: insert / re-archive on a
 * content change / skip when unchanged, CH-first then the PG watermark. `localConcurrency:1`
 * preserves the single-worker invariant (the read-modify-write below is not otherwise atomic).
 */
@Injectable()
export class OffChainArchiveConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger('OffChainArchiveConsumer');

  constructor(
    @Inject(QUEUE_WORKER_PORT) private readonly queue: QueueWorkerPort,
    private readonly daoSourceRepo: DaoSourceRepository,
    private readonly archiveEventRepo: ArchiveEventRepository,
    @Inject(OFF_CHAIN_ARCHIVE_WRITERS)
    private readonly writers: Map<string, OffChainArchiveWriteFn>,
    private readonly dlqRepo: DlqRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work<OffChainArchiveJob>(
      OFF_CHAIN_ARCHIVE_QUEUE,
      { localConcurrency: 1 },
      async (jobs) => {
        for (const job of jobs) {
          await this.consume(job.data);
        }
      },
    );
    this.logger.log('off_chain_archive_consumer_registered');
  }

  /** Process one off-chain job: resolve source, mutable-latest write. Public for testing. */
  async consume(job: OffChainArchiveJob): Promise<void> {
    const src = await this.daoSourceRepo.findByIdWithChain(job.daoSourceId);
    if (!src) {
      await this.dlqRepo.insert(
        makeDlqRow(job, new Error(`dao_source not found: ${job.daoSourceId}`)),
      );
      chainMetrics.offChainArchiveConsumer.add(1, { source: job.sourceType, result: 'unmapped' });
      return; // ack — config anomaly; don't burn retries
    }

    const write = this.writers.get(job.sourceType);
    if (!write) {
      await this.dlqRepo.insert(
        makeDlqRow(job, new Error(`no off-chain writer for source_type: ${job.sourceType}`)),
      );
      chainMetrics.offChainArchiveConsumer.add(1, { source: job.sourceType, result: 'unmapped' });
      return;
    }

    const ctx: ArchiveConsumeContext = {
      daoSourceId: src.id,
      sourceType: src.source_type,
      chainId: src.chain_id,
      sourceLabel: src.source_type,
    };

    try {
      const existing = await this.archiveEventRepo.findByExternalId({
        sourceType: ctx.sourceType,
        chainId: ctx.chainId,
        externalId: job.externalId,
      });

      if (existing && existing.content_hash === job.contentHash) {
        chainMetrics.offChainArchiveConsumer.add(1, {
          source: ctx.sourceLabel,
          result: 'skip_unchanged',
        });
        return;
      }

      // PG-maintained monotonic version: bumped only on a content change; the CH
      // ReplacingMergeTree(version) sort key so the latest edit wins deterministically.
      const version = existing ? (existing.version ?? 0) + 1 : 1;

      // CH-first (per-source, idempotent on (external_id, version)).
      await write(ctx, {
        externalId: job.externalId,
        contentHash: job.contentHash,
        ordinal: job.ordinal,
        version,
        payload: job.payload,
      });

      if (!existing) {
        await this.archiveEventRepo.insert({
          source_type: ctx.sourceType,
          dao_source_id: ctx.daoSourceId,
          chain_id: ctx.chainId,
          external_id: job.externalId,
          content_hash: job.contentHash,
          version,
          derivation_ordinal: job.ordinal,
          event_type: job.eventType,
          received_at: new Date(),
          derived_at: null,
        });
        chainMetrics.offChainArchiveConsumer.add(1, {
          source: ctx.sourceLabel,
          result: 'inserted',
        });
      } else {
        // CAS-guarded update + full derivation-watermark reset (ADR-071).
        await this.archiveEventRepo.reArchiveOffchain(
          { sourceType: ctx.sourceType, chainId: ctx.chainId, externalId: job.externalId },
          { contentHash: job.contentHash, version, ordinal: job.ordinal },
        );
        chainMetrics.offChainArchiveConsumer.add(1, {
          source: ctx.sourceLabel,
          result: 're_archived',
        });
      }
    } catch (err) {
      // Transient (CH/PG) → throw → retry → deadLetter → OffChainArchiveDlqBridge.
      chainMetrics.offChainArchiveConsumer.add(1, {
        source: ctx.sourceLabel,
        result: 'transient_dlq',
      });
      throw err;
    }
  }
}

function makeDlqRow(job: OffChainArchiveJob, err: Error): NewIngestionDlq {
  const now = new Date();
  return {
    stage: OFF_CHAIN_DLQ_STAGE,
    source: job.sourceType,
    // ingestion_dlq has no external_id column — carry the off-chain identity in the payload.
    payload: {
      external_id: job.externalId,
      dao_source_id: job.daoSourceId,
      event_type: job.eventType,
      content_hash: job.contentHash,
      raw: job.payload,
      reason: err.message,
    },
    error: { name: err.name, message: err.message },
    retries: 0,
    first_seen_at: now,
    last_attempt_at: now,
    archive_source_type: job.sourceType,
    archive_chain_id: 'off-chain',
    archive_tx_hash: null,
    archive_log_index: null,
    archive_block_hash: null,
  };
}
