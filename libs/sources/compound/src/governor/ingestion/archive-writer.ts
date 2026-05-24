import { chainMetrics } from '@libs/chain';
import type { LogEvent, Logger } from '@libs/chain';
import type {
  ArchiveEventRepository,
  DlqRepository,
  NewArchiveEvent,
  NewIngestionDlq,
} from '@libs/db';
import type {
  ArchiveWriteContext,
  GovernorArchiveWriterDeps,
  ArchiveWriteOutcome,
} from './archive-writer.types';
import type { CompoundGovernorEvent } from '../domain/types';
import type { GovernorEventRepository } from '../persistence/event-repository';

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown };
    return { name: e.name, message: e.message, stack: e.stack, code: e.code };
  }
  return { name: 'UnknownError', message: String(err) };
}

export class GovernorArchiveWriter {
  private readonly eventRepo: GovernorEventRepository;
  private readonly archiveEventRepo: ArchiveEventRepository;
  private readonly dlqRepo: DlqRepository;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(deps: GovernorArchiveWriterDeps) {
    this.eventRepo = deps.eventRepo;
    this.archiveEventRepo = deps.archiveEventRepo;
    this.dlqRepo = deps.dlqRepo;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
  }

  async write(
    ctx: ArchiveWriteContext,
    decoded: CompoundGovernorEvent,
    logRef: LogEvent,
  ): Promise<ArchiveWriteOutcome> {
    // Step 1 — existence check (5-tuple, status-agnostic)
    const existing = await this.archiveEventRepo.find({
      sourceType: ctx.sourceType,
      chainId: ctx.chainId,
      txHash: logRef.txHash,
      logIndex: logRef.logIndex,
      blockHash: logRef.blockHash,
    });

    if (existing) {
      chainMetrics.archiveDuplicateSkip.add(1, { source: ctx.sourceLabel });
      this.logger.debug('archive_check_skip', {
        ...logRef,
        blockNumber: logRef.blockNumber.toString(),
        existing_id: existing.id,
      });
      return { result: 'skipped_existing' };
    }

    const receivedAt = this.now();

    try {
      // Step 2 — event archive insert (idempotent; CH failures route to DLQ via catch below)
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

      // Step 3 — confirmation insert with retry (retries managed by ArchiveEventRepository)
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
      const result = await this.archiveEventRepo.insert(row);

      if (result?.id) {
        chainMetrics.archiveWrites.add(1, {
          source: ctx.sourceLabel,
          event_type: decoded.type,
          result: 'inserted',
        });
        this.logger.debug('confirmation_inserted', {
          ...logRef,
          blockNumber: logRef.blockNumber.toString(),
          archive_id: result.id,
        });
        return { result: 'inserted' };
      }

      // ON CONFLICT fired — concurrent writer beat us; idempotent
      chainMetrics.archiveWrites.add(1, {
        source: ctx.sourceLabel,
        event_type: decoded.type,
        result: 'skipped_conflict',
      });
      this.logger.debug('confirmation_conflict_skip', {
        ...logRef,
        blockNumber: logRef.blockNumber.toString(),
      });
      return { result: 'skipped_conflict' };
    } catch (err) {
      return await this.routeToDlq(err, ctx, decoded, logRef, receivedAt);
    }
  }

  private async routeToDlq(
    err: unknown,
    ctx: ArchiveWriteContext,
    decoded: CompoundGovernorEvent,
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
