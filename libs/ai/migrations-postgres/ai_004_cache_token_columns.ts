import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('ai_cost_log')
    .addColumn('cache_creation_input_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();
  await db.schema
    .alterTable('ai_cost_log')
    .addColumn('cache_read_input_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('ai_cost_log').dropColumn('cache_read_input_tokens').execute();
  await db.schema.alterTable('ai_cost_log').dropColumn('cache_creation_input_tokens').execute();
}
