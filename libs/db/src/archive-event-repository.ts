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

/** Off-chain identity: source_type + chain_id + source-native external_id (ADR-071). */
export interface ArchiveEventExternalKey {
  sourceType: string;
  chainId: string;
  externalId: string;
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
      .where('external_id', 'is', null)
      .where('source_type', '=', key.sourceType)
      .where('chain_id', '=', key.chainId)
      .where('tx_hash', '=', key.txHash)
      .where('log_index', '=', key.logIndex);
    if (key.blockHash != null) {
      query = query.where('block_hash', '=', key.blockHash);
    }
    return query.executeTakeFirst();
  }

  /** Off-chain existence check by source-native external_id; returns the current
   *  content_hash + version for the mutable-latest insert/re-archive/skip decision. */
  async findByExternalId(
    key: ArchiveEventExternalKey,
  ): Promise<{ id: string; content_hash: string | null; version: number | null } | undefined> {
    return this.pgDb
      .selectFrom('archive_event')
      .select(['id', 'content_hash', 'version'])
      .where('source_type', '=', key.sourceType)
      .where('chain_id', '=', key.chainId)
      .where('external_id', '=', key.externalId)
      .executeTakeFirst();
  }

  /** Mutable-latest re-archive: advance content_hash + version and reset ALL derivation
   *  watermarks so the edited row is re-resolved and re-derived from scratch. CAS-guarded
   *  on `version < :version` so an out-of-order older edit cannot clobber a newer one.
   *  Returns true iff a row was updated (false when the guard rejects a stale edit). */
  async reArchiveOffchain(
    key: ArchiveEventExternalKey,
    next: { contentHash: string; version: number; ordinal: string | null },
  ): Promise<boolean> {
    const result = await this.pgDb
      .updateTable('archive_event')
      .set({
        content_hash: next.contentHash,
        version: next.version,
        derivation_ordinal: next.ordinal,
        received_at: sql`now()`,
        derived_at: null,
        derivation_actor_resolved_at: null,
        derivation_attempt_count: 0,
        actor_resolution_attempt_count: 0,
      })
      .where('source_type', '=', key.sourceType)
      .where('chain_id', '=', key.chainId)
      .where('external_id', '=', key.externalId)
      .where('version', '<', next.version)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n) > 0;
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

  async insert(row: NewArchiveEvent): Promise<{ id: string } | undefined> {
    // Bind the predicate of the matching partial unique index so Postgres infers the
    // correct one: off-chain rows (external_id set) target archive_event_external_id_key;
    // EVM rows target archive_event_idempotency_key. ON CONFLICT DO NOTHING for both —
    // mutable-latest re-archive is the off-chain consumer's concern. See ADR-071.
    const isOffChain = row.external_id != null;
    for (let attempt = 0; attempt <= this.retryBackoffMs.length; attempt++) {
      try {
        return await this.pgDb
          .insertInto('archive_event')
          .values(row)
          .onConflict((oc) =>
            isOffChain
              ? oc
                  .columns(['source_type', 'chain_id', 'external_id'])
                  .where('external_id', 'is not', null)
                  .doNothing()
              : oc
                  .columns(['source_type', 'chain_id', 'tx_hash', 'log_index'])
                  .where('external_id', 'is', null)
                  .doNothing(),
          )
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
