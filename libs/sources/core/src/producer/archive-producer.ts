import type { Kysely, Transaction } from 'kysely';
import type { EventsListener, LogEvent } from '@libs/chain';
import type { PgDatabase, SeenLogRepository, NewSeenLog } from '@libs/db';

export interface RawLogJob {
  chainId: string;
  blockNumber: string; // stringified bigint
  blockHash: string;
  txHash: string;
  logIndex: number;
  address: string; // consumer resolves address → source (D-EXEC-1: no sourceType in payload)
  topics: string[];
  data: string;
}

export interface ArchiveProducerDeps {
  pgDb: Kysely<PgDatabase>;
  seenLog: SeenLogRepository;
  /** Called inside the open transaction; must be boss.send('archive_ch', job, { db: fromKysely(trx) }) */
  enqueue: (job: RawLogJob, trx: Transaction<PgDatabase>) => Promise<void>;
  logger: {
    debug: (msg: string, ctx?: unknown) => void;
    error: (msg: string, ctx?: unknown) => void;
  };
}

/**
 * Generic domain-blind producer (G1). Runs in the live polling listener for every source.
 * Does NOT decode, classify, or touch CH / archive_event — the consumer owns that.
 *
 * Per-log transaction: either seen_log row AND the job commit together, or neither.
 * A mid-batch failure commits logs 1..k and leaves k+1..n to the next in-window tick re-scan.
 */
export function makeArchiveProducer(deps: ArchiveProducerDeps): EventsListener<LogEvent> {
  return async (events) => {
    for (const e of events) {
      await deps.pgDb.transaction().execute(async (trx) => {
        const coord: NewSeenLog = {
          chain_id: e.chainId,
          tx_hash: e.txHash,
          log_index: e.logIndex,
          block_number: e.blockNumber.toString(),
        };
        const isNew = await deps.seenLog.recordIfNew(trx, coord);
        if (!isNew) {
          // Window re-scan of an already-recorded coordinate — MUST NOT enqueue (G2).
          deps.logger.debug('seen_log_skip', { txHash: e.txHash, logIndex: e.logIndex });
          return;
        }
        await deps.enqueue(
          {
            chainId: e.chainId,
            blockNumber: e.blockNumber.toString(),
            blockHash: e.blockHash,
            txHash: e.txHash,
            logIndex: e.logIndex,
            address: e.address,
            topics: e.topics,
            data: e.data,
          },
          trx,
        );
      });
    }
  };
}
