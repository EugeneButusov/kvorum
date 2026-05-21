import { chainMetrics } from '@libs/chain';
import type { LogEvent, Logger } from '@libs/chain';
import type {
  ConfirmationRepository,
  DlqRepository,
  NewArchiveConfirmation,
  NewIngestionDlq,
} from '@libs/db';
import type { CompTokenArchiveWriterDeps } from './archive-writer.types';
import type { ArchiveWriteContext, ArchiveWriteOutcome } from '../../shared';
import { serializeError } from '../../shared';
import type { CompTokenEvent } from '../domain/types';
import type { CompTokenEventRepository } from '../persistence/event-repository';

export class CompTokenArchiveWriter {
  private readonly eventRepo: CompTokenEventRepository;
  private readonly confirmationRepo: ConfirmationRepository;
  private readonly dlqRepo: DlqRepository;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(deps: CompTokenArchiveWriterDeps) {
    this.eventRepo = deps.eventRepo;
    this.confirmationRepo = deps.confirmationRepo;
    this.dlqRepo = deps.dlqRepo;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
  }

  async write(
    ctx: ArchiveWriteContext,
    decoded: CompTokenEvent,
    logRef: LogEvent,
  ): Promise<ArchiveWriteOutcome> {
    const existing = await this.confirmationRepo.find({
      sourceType: ctx.sourceType,
      chainId: ctx.chainId,
      txHash: logRef.txHash,
      logIndex: logRef.logIndex,
      blockHash: logRef.blockHash,
    });

    if (existing) {
      chainMetrics.archiveSkippedExistence.add(1, { source: ctx.sourceLabel });
      return { result: 'skipped_existing' };
    }

    const receivedAt = this.now();
    const confirmationStatus = ctx.confirmationClassifier?.(logRef.blockNumber) ?? 'pending';

    try {
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

      const row: NewArchiveConfirmation = {
        source_type: ctx.sourceType,
        dao_source_id: ctx.daoSourceId,
        chain_id: ctx.chainId,
        block_number: logRef.blockNumber.toString(),
        block_hash: logRef.blockHash,
        tx_hash: logRef.txHash,
        log_index: logRef.logIndex,
        event_type: decoded.type,
        received_at: receivedAt,
        confirmation_status: confirmationStatus,
        confirmed_at: confirmationStatus === 'confirmed' ? receivedAt : null,
        orphaned_at: null,
        orphaned_by_reorg_event_id: null,
        derived_at: null,
      };

      const result = await this.confirmationRepo.insert(row);

      if (result?.id) {
        chainMetrics.archiveWrites.add(1, {
          source: ctx.sourceLabel,
          event_type: decoded.type,
          result: 'inserted',
        });
        return { result: 'inserted' };
      }

      chainMetrics.archiveWrites.add(1, {
        source: ctx.sourceLabel,
        event_type: decoded.type,
        result: 'skipped_conflict',
      });
      return { result: 'skipped_conflict' };
    } catch (err) {
      return await this.routeToDlq(err, ctx, decoded, logRef, receivedAt);
    }
  }

  private async routeToDlq(
    err: unknown,
    ctx: ArchiveWriteContext,
    decoded: CompTokenEvent,
    logRef: LogEvent,
    receivedAt: Date,
  ): Promise<ArchiveWriteOutcome> {
    const dlqRow: NewIngestionDlq = {
      stage: 'delegation_archive_write',
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
      this.logger.error('dlq_routed', { txHash: logRef.txHash, error: String(err) });
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
