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
import { sleep } from '@libs/utils';
import type { ChEventRepository } from './ch-event-repository';
import type {
  ArchiveWriteContext,
  ArchiveWriterDeps,
  ArchiveWriteOutcome,
} from './archive-writer.types';
import type { CompoundGovernorEvent } from './types';

const DEFAULT_RETRY_BACKOFF_MS = [200, 600, 1800] as const;

/** SQLSTATE codes that indicate a transient PG error worth retrying. */
const TRANSIENT_SQLSTATES = new Set([
  '08000',
  '08001',
  '08003',
  '08006',
  '08007', // connection-level
  '57P01',
  '57P02',
  '57P03', // admin/shutdown
  '40001',
  '40P01', // serialization
  '53300', // too_many_connections
  '08004', // server_rejected_establishment
]);

/** Node-level error codes (from node-pg DatabaseError.code) treated as transient. */
const TRANSIENT_NODE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']);

export function isTransientPgError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const code = typeof e['code'] === 'string' ? e['code'] : '';
  if (TRANSIENT_SQLSTATES.has(code)) return true;
  if (TRANSIENT_NODE_CODES.has(code)) return true;
  return false;
}

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
  private readonly retryBackoffMs: readonly number[];

  constructor(deps: ArchiveWriterDeps) {
    this.chRepo = deps.chRepo;
    this.confirmationRepo = deps.confirmationRepo;
    this.dlqRepo = deps.dlqRepo;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
    this.retryBackoffMs = deps.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
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

    // Step 3 — PG insert with retry
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

    for (let attempt = 0; attempt <= this.retryBackoffMs.length; attempt++) {
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
        } else {
          // ON CONFLICT fired — concurrent writer beat us; idempotent
          getArchiveWritesTotal().inc({ source: ctx.sourceLabel, result: 'skipped_conflict' });
          this.logger.debug('pg_conflict_skip', {
            ...logRef,
            blockNumber: logRef.blockNumber.toString(),
          });
          return { result: 'skipped_conflict' };
        }
      } catch (err) {
        const transient = isTransientPgError(err);
        if (transient && attempt < this.retryBackoffMs.length) {
          this.logger.warn('pg_insert_retry', { attempt, error: String(err) });
          await sleep(this.retryBackoffMs[attempt]!);
          continue;
        }
        return await this.routePgFailureToDlq(err, ctx, logRef, pgReceivedAt);
      }
    }

    // Unreachable; the loop always returns or throws
    return await this.routePgFailureToDlq(
      new Error('retry loop exhausted without return'),
      ctx,
      logRef,
      pgReceivedAt,
    );
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
      retries: this.retryBackoffMs.length,
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
      // Step 5 — DLQ itself is unreachable
      getDualWritePgUnreachableTotal().inc({ source: ctx.sourceLabel });
      this.logger.error('dlq_insert_failed', {
        originalError: String(err),
        dlqError: String(dlqErr),
      });
      return { result: 'pg_unreachable' };
    }
  }
}
