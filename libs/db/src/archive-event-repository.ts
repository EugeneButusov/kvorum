import { sql, type Kysely } from 'kysely';
import type { NewArchiveConfirmation, PgDatabase } from './schema/pg';
import { isCanonicalPartialUniqueViolation, isTransientDbError } from './utils';

export interface ArchiveEventKey {
  sourceType: string;
  chainId: string;
  txHash: string;
  logIndex: number;
  blockHash?: string;
}

const DEFAULT_RETRY_BACKOFF_MS = [200, 600, 1800] as const;

export class ArchiveEventRepository {
  private readonly retryBackoffMs: readonly number[];

  constructor(
    private readonly pgDb: Kysely<PgDatabase>,
    retryBackoffMs: readonly number[] = DEFAULT_RETRY_BACKOFF_MS,
  ) {
    this.retryBackoffMs = retryBackoffMs;
  }

  async find(key: ArchiveEventKey): Promise<{ id: string } | undefined> {
    let query = this.pgDb
      .selectFrom('archive_event')
      .select('id')
      .where('source_type', '=', key.sourceType)
      .where('chain_id', '=', key.chainId)
      .where('tx_hash', '=', key.txHash)
      .where('log_index', '=', key.logIndex);
    if (key.blockHash != null) {
      query = query.where('block_hash', '=', key.blockHash);
    }
    return query.executeTakeFirst();
  }

  async countUnderivedBySourceType(sourceType: string) {
    return this.pgDb
      .selectFrom('archive_event')
      .select(({ fn }) => ['chain_id', 'source_type', fn.count<number>('id').as('count')])
      .where('derived_at', 'is', null)
      .where('source_type', '=', sourceType)
      .groupBy(['chain_id', 'source_type'])
      .execute();
  }

  async insert(row: NewArchiveConfirmation): Promise<{ id: string } | undefined> {
    for (let attempt = 0; attempt <= this.retryBackoffMs.length; attempt++) {
      try {
        return await this.pgDb
          .insertInto('archive_event')
          .values(row)
          .onConflict((oc) => oc.constraint('archive_event_idempotency_key').doNothing())
          .returning('id')
          .executeTakeFirst();
      } catch (err) {
        const retriable = isTransientDbError(err) || isCanonicalPartialUniqueViolation(err);
        if (retriable && attempt < this.retryBackoffMs.length) {
          await new Promise((resolve) => setTimeout(resolve, this.retryBackoffMs[attempt]));
          continue;
        }
        throw err;
      }
    }
    throw new Error('retry loop exhausted without return');
  }

  // Transitional alias while PromotionSweepService still exists.
  async promotePending(chainId: string, thresholdBlockNumber: bigint): Promise<number> {
    const result = await this.pgDb
      .updateTable('archive_event')
      .set({
        confirmation_status: 'confirmed',
        confirmed_at: sql`now()`,
      })
      .where('chain_id', '=', chainId)
      .where('confirmation_status', '=', 'pending')
      .where('block_number', '<=', thresholdBlockNumber.toString())
      .executeTakeFirst();

    return Number(result?.numUpdatedRows ?? 0n);
  }
}
