import { sql } from 'kysely';

/**
 * Wrap a ReplacingMergeTree table name in FINAL for merge-on-read semantics.
 * Use in `.selectFrom(chFinal<T>('table').as('alias'))`. NOTE: Kysely's `.modifyEnd()`
 * emits FINAL after ORDER BY/LIMIT, which ClickHouse rejects — this helper puts
 * FINAL in the table expression where ClickHouse expects it.
 */
export function chFinal<T = unknown>(table: string) {
  return sql<T>`${sql.raw(table)} FINAL`;
}
