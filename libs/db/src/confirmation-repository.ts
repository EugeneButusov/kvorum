import { sql, type Kysely } from 'kysely';
import type { NewArchiveConfirmation, PgDatabase } from './schema/pg';
import { isTransientDbError } from './utils';

export interface ConfirmationKey {
  sourceType: string;
  chainId: string;
  txHash: string;
  logIndex: number;
  blockHash: string;
}

const DEFAULT_RETRY_BACKOFF_MS = [200, 600, 1800] as const;

export class ConfirmationRepository {
  private readonly retryBackoffMs: readonly number[];

  constructor(
    private readonly pgDb: Kysely<PgDatabase>,
    retryBackoffMs: readonly number[] = DEFAULT_RETRY_BACKOFF_MS,
  ) {
    this.retryBackoffMs = retryBackoffMs;
  }

  async find(key: ConfirmationKey): Promise<{ id: string } | undefined> {
    return this.pgDb
      .selectFrom('archive_confirmation')
      .select('id')
      .where('source_type', '=', key.sourceType)
      .where('chain_id', '=', key.chainId)
      .where('tx_hash', '=', key.txHash)
      .where('log_index', '=', key.logIndex)
      .where('block_hash', '=', key.blockHash)
      .executeTakeFirst();
  }

  async countPendingBySourceType(sourceType: string) {
    return this.pgDb
      .selectFrom('archive_confirmation')
      .select(({ fn }) => ['chain_id', 'source_type', fn.count<number>('id').as('count')])
      .where('confirmation_status', '=', 'pending')
      .where('source_type', '=', sourceType)
      .groupBy(['chain_id', 'source_type'])
      .execute();
  }

  /** Set-based promotion. Idempotent: re-running with the same threshold returns 0.
   *  Returns the count of rows transitioned to confirmed. */
  async promotePending(chainId: number, thresholdBlockNumber: bigint): Promise<number> {
    const result = await this.pgDb
      .updateTable('archive_confirmation')
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

  async insert(row: NewArchiveConfirmation): Promise<{ id: string } | undefined> {
    for (let attempt = 0; attempt <= this.retryBackoffMs.length; attempt++) {
      try {
        return await this.pgDb
          .insertInto('archive_confirmation')
          .values(row)
          .onConflict((oc) => oc.constraint('archive_confirmation_idempotency_key').doNothing())
          .returning('id')
          .executeTakeFirst();
      } catch (err) {
        if (isTransientDbError(err) && attempt < this.retryBackoffMs.length) {
          await new Promise((resolve) => setTimeout(resolve, this.retryBackoffMs[attempt]));
          continue;
        }
        throw err;
      }
    }
    throw new Error('retry loop exhausted without return');
  }
}
