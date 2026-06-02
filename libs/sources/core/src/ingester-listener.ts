import { chainMetrics } from '@libs/chain';
import type { EventsListener, LogEvent, Logger } from '@libs/chain';
import type { DlqRepository, NewIngestionDlq } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ArchiveWriteContext } from './archive-writer-types';
import type { BaseArchiveWriter } from './base-archive-writer';
import { DecodeError } from './decode-error';
import type { IngesterListenerOptions } from './listener-options';
import { serializeError } from './serialize-error';

export function makeIngesterListener<TEvent extends { type: ArchiveEventType; payload: unknown }>(
  deps: {
    archiveWriter: BaseArchiveWriter<TEvent>;
    context: ArchiveWriteContext;
    logger: Logger;
    dlqRepo: DlqRepository;
  },
  decode: (log: LogEvent) => TEvent,
  options: IngesterListenerOptions = {},
): EventsListener<LogEvent> {
  return async (events: LogEvent[]) => {
    const batchStartMs = Date.now();
    try {
      for (const log of events) {
        let decoded: TEvent;
        try {
          decoded = decode(log);
        } catch (err) {
          await routeDecodeErrorToDlq(deps, log, err);
          chainMetrics.archiveDecodeErrors.add(1, {
            source: deps.context.sourceLabel,
            reason: err instanceof DecodeError ? err.reason : 'unknown',
          });
          continue;
        }

        try {
          await deps.archiveWriter.write(deps.context, decoded, log);
        } catch (err) {
          chainMetrics.archiveChWriteErrors.add(1, { source: deps.context.sourceLabel });
          deps.logger.error('ch_write_error', {
            txHash: log.txHash,
            logIndex: log.logIndex,
            blockHash: log.blockHash,
            error: String(err),
          });
          if ((options.onWriteFailure ?? 'swallow') === 'throw') throw err;
        }
      }
    } finally {
      chainMetrics.batchDuration.record((Date.now() - batchStartMs) / 1000, {
        source: deps.context.sourceLabel,
      });
    }
  };
}

async function routeDecodeErrorToDlq(
  deps: { context: ArchiveWriteContext; logger: Logger; dlqRepo: DlqRepository },
  log: LogEvent,
  err: unknown,
): Promise<void> {
  const reason = err instanceof DecodeError ? err.reason : 'unknown';
  const dlqRow: NewIngestionDlq = {
    stage: 'archive_decode',
    source: deps.context.sourceLabel,
    payload: {
      raw: { topics: log.topics, data: log.data },
      block_number: log.blockNumber.toString(),
      reason,
    },
    error: serializeError(err),
    retries: 0,
    first_seen_at: new Date(),
    last_attempt_at: new Date(),
    archive_source_type: deps.context.sourceType,
    archive_chain_id: deps.context.chainId,
    archive_tx_hash: log.txHash,
    archive_log_index: log.logIndex,
    archive_block_hash: log.blockHash,
  };

  try {
    await deps.dlqRepo.insert(dlqRow);
    deps.logger.error('decode_error_dlq_routed', {
      txHash: log.txHash,
      logIndex: log.logIndex,
      blockHash: log.blockHash,
      reason,
    });
  } catch (dlqErr) {
    deps.logger.error('decode_error_dlq_insert_failed', {
      originalError: String(err),
      dlqError: String(dlqErr),
    });
  }
}
