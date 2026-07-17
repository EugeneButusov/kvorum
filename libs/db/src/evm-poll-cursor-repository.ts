import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';

/**
 * The EVM live poller's per-source watermark (migration 0011).
 *
 * `read` resolves the block a source should resume *after*, in order:
 *
 *  1. `evm_poll_cursor` — the poller's own watermark, written each time a batch is accepted.
 *  2. `max(archive_event.block_number)` — the source has been ingested before (almost always by a
 *     backfill) but never polled. Resuming here is what makes the backfill→poll handoff seamless:
 *     without it a source that finished backfilling yesterday would resume at today's head and
 *     silently skip everything in between.
 *  3. `null` — never seen. The poller falls back to its confirmed-head window rather than scanning
 *     from genesis; reaching back through history is a backfill's job, not the live path's.
 */
export class EvmPollCursorRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async read(daoSourceId: string): Promise<bigint | null> {
    const cursor = await this.db
      .selectFrom('evm_poll_cursor')
      .select('last_polled_block')
      .where('dao_source_id', '=', daoSourceId)
      .executeTakeFirst();
    if (cursor !== undefined) return BigInt(cursor.last_polled_block);

    const archived = await this.db
      .selectFrom('archive_event')
      .select(({ fn }) => fn.max('block_number').as('max_block'))
      .where('dao_source_id', '=', daoSourceId)
      .where('block_number', 'is not', null)
      .executeTakeFirst();
    const maxBlock = archived?.max_block;
    return maxBlock == null ? null : BigInt(maxBlock);
  }

  /** Idempotent upsert. Never moves the watermark backwards: ticks can only ever be re-run, and a
   *  regression would re-open a gap this table exists to prevent. */
  async write(daoSourceId: string, lastPolledBlock: bigint): Promise<void> {
    await this.db
      .insertInto('evm_poll_cursor')
      .values({
        dao_source_id: daoSourceId,
        last_polled_block: lastPolledBlock.toString(),
        updated_at: sql<Date>`now()`,
      })
      .onConflict((oc) =>
        oc.column('dao_source_id').doUpdateSet({
          last_polled_block: sql<string>`greatest(evm_poll_cursor.last_polled_block, excluded.last_polled_block)`,
          updated_at: sql<Date>`now()`,
        }),
      )
      .execute();
  }
}
