import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── abi_cache ────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('abi_cache')
    .addColumn('chain_id', sql`varchar(32)`, (col) => col.notNull())
    .addColumn('address', 'text', (col) => col.notNull().check(sql`address = lower(address)`))
    .addColumn('abi', 'jsonb', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('fetched_at', 'timestamptz', (col) => col.notNull())
    // Ordered array of lowercase addresses for the proxy hop list, terminating
    // in the implementation. null means this row is the final implementation.
    .addColumn('implementation_chain', 'jsonb')
    .addPrimaryKeyConstraint('abi_cache_pkey', ['chain_id', 'address'])
    .execute();

  // ── selector_index ───────────────────────────────────────────────────────────
  await db.schema
    .createTable('selector_index')
    .addColumn('selector', 'text', (col) => col.notNull())
    .addColumn('signature', 'text', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('imported_at', 'timestamptz', (col) => col.notNull())
    .addPrimaryKeyConstraint('selector_index_pkey', ['selector', 'signature'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('selector_index').execute();
  await db.schema.dropTable('abi_cache').execute();
}
