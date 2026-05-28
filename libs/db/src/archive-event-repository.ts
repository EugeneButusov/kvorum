import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { NewArchiveEvent, PgDatabase } from './schema/pg';
import { isCanonicalPartialUniqueViolation, isTransientDbError } from './utils';

export interface ArchiveEventKey {
  sourceType: string;
  chainId: string;
  txHash: string;
  logIndex: number;
  blockHash?: string;
}

export interface ArchiveEventTuple {
  chainId: string;
  txHash: string;
  logIndex: number;
}

export interface ArchiveEventCursorRow {
  id: string;
  source_type: string;
  chain_id: string;
  tx_hash: string;
  log_index: number;
  block_hash: string;
  block_number: string;
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

  async findMaxBlockNumber(daoSourceId: string): Promise<bigint | null> {
    const row = await this.pgDb
      .selectFrom('archive_event')
      .select(sql<string>`max(block_number::bigint)`.as('max_block'))
      .where('dao_source_id', '=', daoSourceId)
      .executeTakeFirst();
    return row?.max_block != null ? BigInt(row.max_block) : null;
  }

  async findExistingTuples(
    sourceType: string,
    tuples: readonly ArchiveEventTuple[],
  ): Promise<Set<string>> {
    if (tuples.length === 0) return new Set();
    const rows = await this.pgDb
      .selectFrom('archive_event')
      .select(['chain_id', 'tx_hash', 'log_index'])
      .where('source_type', '=', sourceType)
      .where(({ eb, or }) =>
        or(
          tuples.map((tuple) =>
            eb.and([
              eb('chain_id', '=', tuple.chainId),
              eb('tx_hash', '=', tuple.txHash),
              eb('log_index', '=', tuple.logIndex),
            ]),
          ),
        ),
      )
      .execute();
    return new Set(rows.map((row) => `${row.chain_id}:${row.tx_hash}:${row.log_index}`));
  }

  async listByDaoSourceAfterCursor(
    daoSourceId: string,
    cursor: { blockNumber: bigint; txHash: string; logIndex: number },
    limit: number,
  ): Promise<ArchiveEventCursorRow[]> {
    return this.pgDb
      .selectFrom('archive_event')
      .select([
        'id',
        'source_type',
        'chain_id',
        'tx_hash',
        'log_index',
        'block_hash',
        'block_number',
      ])
      .where('dao_source_id', '=', daoSourceId)
      .where(({ eb, or }) =>
        or([
          eb(sql`archive_event.block_number::bigint`, '>', cursor.blockNumber.toString()),
          eb.and([
            eb(sql`archive_event.block_number::bigint`, '=', cursor.blockNumber.toString()),
            eb('tx_hash', '>', cursor.txHash),
          ]),
          eb.and([
            eb(sql`archive_event.block_number::bigint`, '=', cursor.blockNumber.toString()),
            eb('tx_hash', '=', cursor.txHash),
            eb('log_index', '>', cursor.logIndex),
          ]),
        ]),
      )
      .orderBy(sql`archive_event.block_number::bigint`, 'asc')
      .orderBy('tx_hash', 'asc')
      .orderBy('log_index', 'asc')
      .limit(limit)
      .execute();
  }

  async insert(row: NewArchiveEvent): Promise<{ id: string } | undefined> {
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
}
