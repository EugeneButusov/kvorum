import type { Kysely } from 'kysely';
import type { NewSelectorIndex, PgDatabase, SelectorIndex } from './schema/pg';

export class SelectorIndexRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /**
   * Bulk-insert selector → signature mappings. Skips rows that already exist.
   * Returns the number of rows actually inserted.
   */
  async bulkInsert(rows: readonly NewSelectorIndex[]): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await this.db
      .insertInto('selector_index')
      .values([...rows])
      .onConflict((oc) => oc.columns(['selector', 'signature']).doNothing())
      .executeTakeFirst();
    return Number(result?.numInsertedOrUpdatedRows ?? 0n);
  }

  /** Returns all known signatures for a given 4-byte selector (may be multiple on collision). */
  async lookupBySelector(selector: string): Promise<readonly SelectorIndex[]> {
    return this.db
      .selectFrom('selector_index')
      .selectAll()
      .where('selector', '=', selector)
      .execute();
  }
}
