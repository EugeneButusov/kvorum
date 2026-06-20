import { sql, type Kysely, type Transaction } from 'kysely';
import type { JsonValue } from '@libs/domain';
import type { PgDatabase } from './schema/pg';

/** Persisted off-chain poll watermark (ADR-071 §off-chain consumer). One row per
 *  dao_source; the cursor blob is the partition-aware TCursor. The upsert runs inside
 *  the producer's per-tick transaction so the cursor advances atomically with the enqueue. */
export class OffChainCursorRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  /** Load the persisted cursor for a source; null when none (poller starts fresh). */
  async load(daoSourceId: string): Promise<JsonValue | null> {
    const row = await this.pgDb
      .selectFrom('off_chain_cursor')
      .select('cursor')
      .where('dao_source_id', '=', daoSourceId)
      .executeTakeFirst();
    return row?.cursor ?? null;
  }

  /** Upsert the cursor within the caller's transaction (atomic with the tick's enqueue). */
  async upsert(
    trx: Transaction<PgDatabase>,
    daoSourceId: string,
    cursor: JsonValue | null,
  ): Promise<void> {
    await trx
      .insertInto('off_chain_cursor')
      .values({ dao_source_id: daoSourceId, cursor, updated_at: sql`now()` })
      .onConflict((oc) =>
        oc.column('dao_source_id').doUpdateSet({ cursor, updated_at: sql`now()` }),
      )
      .execute();
  }
}
