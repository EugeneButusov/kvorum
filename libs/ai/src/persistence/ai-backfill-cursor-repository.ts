import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';

/**
 * Durable full-history backfill walk position per feature (#617). `get` returns null when a feature
 * has never advanced (scan from the start); `upsert` (committed inside the batch-drain transaction)
 * moves it forward, so a restart resumes the walk instead of re-scanning from page 1.
 */
export class AiBackfillCursorRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async get(feature: string, executor: Kysely<PgDatabase> = this.db): Promise<string | null> {
    const row = await executor
      .selectFrom('ai_backfill_cursor')
      .select('cursor')
      .where('feature', '=', feature)
      .executeTakeFirst();
    return row?.cursor ?? null;
  }

  async upsert(
    feature: string,
    cursor: string,
    executor: Kysely<PgDatabase> = this.db,
  ): Promise<void> {
    const now = new Date();
    await executor
      .insertInto('ai_backfill_cursor')
      .values({ feature, cursor, updated_at: now })
      .onConflict((oc) => oc.column('feature').doUpdateSet({ cursor, updated_at: now }))
      .execute();
  }
}
