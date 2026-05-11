import {
  getDualWritePgUnreachableTotal,
  getArchiveSkippedExistenceTotal,
  getArchiveWritesTotal,
} from '@libs/chain';
import type { LogEvent, Logger } from '@libs/chain';
import type {
  ConfirmationRepository,
  DlqRepository,
  NewArchiveConfirmation,
  NewIngestionDlq,
} from '@libs/db';
import type {
  ArchiveWriteContext,
  ArchiveWriterDeps,
  ArchiveWriteOutcome,
} from './archive-writer.types';
import type { ChEventRepository } from './ch-event-repository';
import type { CompoundGovernorEvent } from './types';

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown };
    return { name: e.name, message: e.message, stack: e.stack, code: e.code };
  }
  return { name: 'UnknownError', message: String(err) };
}

export class ArchiveWriter {
  private readonly chRepo: ChEventRepository;
  private readonly confirmationRepo: ConfirmationRepository;
  private readonly dlqRepo: DlqRepository;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(deps: ArchiveWriterDeps) {
    this.chRepo = deps.chRepo;
    this.confirmationRepo = deps.confirmationRepo;
    this.dlqRepo = deps.dlqRepo;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
  }

  async write(
    ctx: ArchiveWriteContext,
    decoded: CompoundGovernorEvent,
    logRef: LogEvent,
  ): Promise<ArchiveWriteOutcome> {
    // Step 1 — PG existence check (5-tuple, status-agnostic)
    const existing = await this.confirmationRepo.find({
      sourceType: ctx.sourceType,
      chainId: ctx.chainId,
      txHash: logRef.txHash,
      logIndex: logRef.logIndex,
      blockHash: logRef.blockHash,
    });

    if (existing) {
      getArchiveSkippedExistenceTotal().inc({ source: ctx.sourceLabel });
      this.logger.debug('archive_check_skip', {
        ...logRef,
        blockNumber: logRef.blockNumber.toString(),
        existing_id: existing.id,
      });
      return { result: 'skipped_existing' };
    }

    const pgReceivedAt = this.now();

    // Step 2 — CH insert (idempotent via ReplacingMergeTree; errors propagate to listener)
    await this.chRepo.insert({
      daoSourceId: ctx.daoSourceId,
      chainId: ctx.chainId,
      blockNumber: logRef.blockNumber.toString(),
      blockHash: logRef.blockHash,
      txHash: logRef.txHash,
      logIndex: logRef.logIndex,
      eventType: decoded.type,
      payload: JSON.stringify(decoded.payload),
    });

    // Step 3 — PG insert with retry (retries managed by ConfirmationRepository)
    const row: NewArchiveConfirmation = {
      source_type: ctx.sourceType,
      dao_source_id: ctx.daoSourceId,
      chain_id: ctx.chainId,
      block_number: logRef.blockNumber.toString(),
      block_hash: logRef.blockHash,
      tx_hash: logRef.txHash,
      log_index: logRef.logIndex,
      event_type: decoded.type,
      received_at: pgReceivedAt,
      confirmation_status: 'pending',
      confirmed_at: null,
      orphaned_at: null,
      orphaned_by_reorg_event_id: null,
      derived_at: null,
    };

    try {
      const result = await this.confirmationRepo.insert(row);

      if (result?.id) {
        getArchiveWritesTotal().inc({ source: ctx.sourceLabel, result: 'inserted' });
        this.logger.debug('pg_inserted', {
          ...logRef,
          blockNumber: logRef.blockNumber.toString(),
          archive_id: result.id,
        });
        return { result: 'inserted' };
      }

      // ON CONFLICT fired — concurrent writer beat us; idempotent
      getArchiveWritesTotal().inc({ source: ctx.sourceLabel, result: 'skipped_conflict' });
      this.logger.debug('pg_conflict_skip', {
        ...logRef,
        blockNumber: logRef.blockNumber.toString(),
      });
      return { result: 'skipped_conflict' };
    } catch (err) {
      return await this.routePgFailureToDlq(err, ctx, logRef, pgReceivedAt);
    }
  }

  private async routePgFailureToDlq(
    err: unknown,
    ctx: ArchiveWriteContext,
    logRef: LogEvent,
    pgReceivedAt: Date,
  ): Promise<ArchiveWriteOutcome> {
    const dlqRow: NewIngestionDlq = {
      stage: 'archive_confirmation_write',
      source: ctx.sourceLabel,
      payload: {
        raw: { topics: logRef.topics, data: logRef.data },
        block_number: logRef.blockNumber.toString(),
      },
      error: serializeError(err),
      retries: 0,
      first_seen_at: pgReceivedAt,
      last_attempt_at: this.now(),
      archive_source_type: ctx.sourceType,
      archive_chain_id: ctx.chainId,
      archive_tx_hash: logRef.txHash,
      archive_log_index: logRef.logIndex,
      archive_block_hash: logRef.blockHash,
    };

    try {
      await this.dlqRepo.insert(dlqRow);
      getArchiveWritesTotal().inc({ source: ctx.sourceLabel, result: 'pg_dlq_routed' });
      this.logger.error('pg_dlq_routed', {
        ...logRef,
        blockNumber: logRef.blockNumber.toString(),
        error: String(err),
      });
      return { result: 'pg_dlq_routed' };
    } catch (dlqErr) {
      getDualWritePgUnreachableTotal().inc({ source: ctx.sourceLabel });
      this.logger.error('dlq_insert_failed', {
        originalError: String(err),
        dlqError: String(dlqErr),
      });
      return { result: 'pg_unreachable' };
    }
  }
}
