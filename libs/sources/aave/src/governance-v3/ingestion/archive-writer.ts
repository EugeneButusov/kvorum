import { chainMetrics } from '@libs/chain';
import type { LogEvent, Logger } from '@libs/chain';
import type {
  ArchiveEventRepository,
  DlqRepository,
  NewArchiveEvent,
  NewIngestionDlq,
} from '@libs/db';
import { serializeError } from '@sources/core';
import type {
  AaveGovernanceArchiveWriterDeps,
  ArchiveWriteContext,
  ArchiveWriteOutcome,
} from './archive-writer.types';
import type { AaveGovernanceV3Event } from '../domain/types';
import type { AaveGovernanceEventRepository } from '../persistence/event-repository';

export class AaveGovernanceArchiveWriter {
  private readonly eventRepo: AaveGovernanceEventRepository;
  private readonly archiveEventRepo: ArchiveEventRepository;
  private readonly dlqRepo: DlqRepository;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(deps: AaveGovernanceArchiveWriterDeps) {
    this.eventRepo = deps.eventRepo;
    this.archiveEventRepo = deps.archiveEventRepo;
    this.dlqRepo = deps.dlqRepo;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
  }

  async writeCore(
    ctx: ArchiveWriteContext,
    decoded: AaveGovernanceV3Event,
    logRef: LogEvent,
  ): Promise<void> {
    const receivedAt = this.now();
    await this.eventRepo.insert({
      daoSourceId: ctx.daoSourceId,
      chainId: ctx.chainId,
      blockNumber: logRef.blockNumber.toString(),
      blockHash: logRef.blockHash,
      txHash: logRef.txHash,
      logIndex: logRef.logIndex,
      eventType: decoded.type,
      payload: JSON.stringify(decoded.payload),
    });
    const row: NewArchiveEvent = {
      source_type: ctx.sourceType,
      dao_source_id: ctx.daoSourceId,
      chain_id: ctx.chainId,
      block_number: logRef.blockNumber.toString(),
      block_hash: logRef.blockHash,
      tx_hash: logRef.txHash,
      log_index: logRef.logIndex,
      event_type: decoded.type,
      received_at: receivedAt,
      derived_at: null,
    };
    await this.archiveEventRepo.insert(row);
  }

  async write(
    ctx: ArchiveWriteContext,
    decoded: AaveGovernanceV3Event,
    logRef: LogEvent,
  ): Promise<ArchiveWriteOutcome> {
    const existing = await this.archiveEventRepo.find({
      sourceType: ctx.sourceType,
      chainId: ctx.chainId,
      txHash: logRef.txHash,
      logIndex: logRef.logIndex,
      blockHash: logRef.blockHash,
    });

    if (existing) {
      chainMetrics.archiveDuplicateSkip.add(1, {
        source: ctx.sourceLabel,
        reason: 'rescan_window',
      });
      this.logger.debug('archive_check_skip', {
        ...logRef,
        blockNumber: logRef.blockNumber.toString(),
        existing_id: existing.id,
      });
      return { result: 'skipped_existing' };
    }

    const receivedAt = this.now();
    try {
      await this.writeCore(ctx, decoded, logRef);
      chainMetrics.archiveWrites.add(1, {
        source: ctx.sourceLabel,
        event_type: decoded.type,
        result: 'inserted',
      });
      this.logger.debug('confirmation_inserted', {
        ...logRef,
        blockNumber: logRef.blockNumber.toString(),
      });
      return { result: 'inserted' };
    } catch (err) {
      return await this.routeToDlq(err, ctx, decoded, logRef, receivedAt);
    }
  }

  private async routeToDlq(
    err: unknown,
    ctx: ArchiveWriteContext,
    decoded: AaveGovernanceV3Event,
    logRef: LogEvent,
    receivedAt: Date,
  ): Promise<ArchiveWriteOutcome> {
    const dlqRow: NewIngestionDlq = {
      stage: 'archive_event_stage',
      source: ctx.sourceLabel,
      payload: {
        raw: { topics: logRef.topics, data: logRef.data },
        block_number: logRef.blockNumber.toString(),
      },
      error: serializeError(err),
      retries: 0,
      first_seen_at: receivedAt,
      last_attempt_at: this.now(),
      archive_source_type: ctx.sourceType,
      archive_chain_id: ctx.chainId,
      archive_tx_hash: logRef.txHash,
      archive_log_index: logRef.logIndex,
      archive_block_hash: logRef.blockHash,
    };

    try {
      await this.dlqRepo.insert(dlqRow);
      chainMetrics.archiveWrites.add(1, {
        source: ctx.sourceLabel,
        event_type: decoded.type,
        result: 'dlq_routed',
      });
      this.logger.error('dlq_routed', {
        ...logRef,
        blockNumber: logRef.blockNumber.toString(),
        error: String(err),
      });
      return { result: 'dlq_routed' };
    } catch (dlqErr) {
      chainMetrics.dualWritePgUnreachable.add(1, { source: ctx.sourceLabel });
      this.logger.error('dlq_insert_failed', {
        originalError: String(err),
        dlqError: String(dlqErr),
      });
      return { result: 'unreachable' };
    }
  }
}
