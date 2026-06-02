import { chainMetrics } from '@libs/chain';
import type { LogEvent, Logger } from '@libs/chain';
import type {
  ArchiveEventRepository,
  DlqRepository,
  NewArchiveEvent,
  NewIngestionDlq,
} from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ArchiveWriteContext, ArchiveWriteOutcome } from './archive-writer-types';
import { serializeError } from './serialize-error';

export abstract class BaseArchiveWriter<
  TEvent extends { type: ArchiveEventType; payload: unknown },
> {
  constructor(
    protected readonly archiveEventRepo: ArchiveEventRepository,
    protected readonly dlqRepo: DlqRepository,
    protected readonly logger: Logger,
    private readonly dlqStage: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Write the event to the source-specific CH table. Implemented by each subclass. */
  protected abstract insertEvent(
    ctx: ArchiveWriteContext,
    decoded: TEvent,
    logRef: LogEvent,
  ): Promise<void>;

  /**
   * Consumer path — CH-first write, no find() pre-check, throws on any failure.
   * Called directly by the archive-log consumer after decode.
   * `receivedAt` is optional; when omitted the clock is sampled here (direct-call path).
   */
  async writeCore(
    ctx: ArchiveWriteContext,
    decoded: TEvent,
    logRef: LogEvent,
    receivedAt: Date = this.now(),
  ): Promise<void> {
    await this.insertEvent(ctx, decoded, logRef);
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

  /**
   * Backfill path — find() short-circuit preserved, DLQ routing on failure.
   * Live path no longer calls this; the consumer owns archiving via writeCore.
   */
  async write(
    ctx: ArchiveWriteContext,
    decoded: TEvent,
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
      await this.writeCore(ctx, decoded, logRef, receivedAt);
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
      return this.routeToDlq(err, ctx, decoded, logRef, receivedAt);
    }
  }

  private async routeToDlq(
    err: unknown,
    ctx: ArchiveWriteContext,
    decoded: TEvent,
    logRef: LogEvent,
    receivedAt: Date,
  ): Promise<ArchiveWriteOutcome> {
    const dlqRow: NewIngestionDlq = {
      stage: this.dlqStage,
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
