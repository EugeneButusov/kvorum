import type { Kysely } from 'kysely';
import type { LogEvent, EventsListener, Logger } from '@libs/chain';
import {
  getArchiveDecodeErrorsTotal,
  getArchiveChWriteErrorsTotal,
  getBatchDurationSeconds,
} from '@libs/chain';
import type { NewIngestionDlq } from '@libs/db';
import type { PgDatabase } from '@libs/db';
import type { ArchiveWriteContext } from './archive-writer';
import { ArchiveWriter } from './archive-writer';
import { decodeCompoundLog } from './decoder';
import { DecodeError } from './types';

export interface IngesterListenerDeps {
  archiveWriter: ArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  pgDb: Kysely<PgDatabase>;
}

/** Returns an EventsListener that decodes and archives Compound Governor log events. */
export function makeIngesterListener(deps: IngesterListenerDeps): EventsListener {
  return async (events: LogEvent[]) => {
    const endTimer = getBatchDurationSeconds().startTimer({ source: deps.context.sourceLabel });
    try {
      for (const log of events) {
        let decoded: ReturnType<typeof decodeCompoundLog>;
        try {
          decoded = decodeCompoundLog(log);
        } catch (err) {
          await routeDecodeErrorToDlq(deps, log, err);
          getArchiveDecodeErrorsTotal().inc({
            source: deps.context.sourceLabel,
            reason: err instanceof DecodeError ? err.reason : 'unknown',
          });
          continue;
        }

        try {
          await deps.archiveWriter.write(deps.context, decoded, log);
        } catch (err) {
          // CH-insert failures propagate as exceptions (ADR-041 rider 2026-05-12 retracted §2).
          // Per-event catch ensures one CH glitch doesn't drop the rest of the batch.
          getArchiveChWriteErrorsTotal().inc({ source: deps.context.sourceLabel });
          deps.logger.error('ch_write_error', {
            txHash: log.txHash,
            logIndex: log.logIndex,
            blockHash: log.blockHash,
            error: String(err),
          });
        }
      }
    } finally {
      endTimer();
    }
  };
}

async function routeDecodeErrorToDlq(
  deps: IngesterListenerDeps,
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
    error:
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { name: 'UnknownError', message: String(err) },
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
    await deps.pgDb.insertInto('ingestion_dlq').values(dlqRow).execute();
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
