import type { Kysely } from 'kysely';
import { sql } from 'kysely';
// getConstructionPlans/getMigrationPlans are module-level named exports — NOT static PgBoss.*
// methods. PgBoss.getConstructionPlans is undefined at runtime; the named import is the API.
// A future pg-boss version bump that ships a schema change needs a new migration emitting
// getMigrationPlans(schema, version) SQL; boot with migrate:false will verify and throw if stale.
import { getConstructionPlans } from 'pg-boss';

const PGBOSS_SCHEMA = 'pgboss';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('seen_log')
    .addColumn('chain_id', 'varchar(32)', (col) => col.notNull())
    .addColumn('tx_hash', 'text', (col) => col.notNull())
    .addColumn('log_index', 'integer', (col) => col.notNull())
    .addColumn('block_number', 'bigint', (col) => col.notNull())
    .addColumn('block_hash', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('seen_log_pkey', ['chain_id', 'tx_hash', 'log_index'])
    .execute();

  // Supports the block-height prune DELETE (chain_id = ? AND block_number < ?)
  await db.schema
    .createIndex('seen_log_chain_block_idx')
    .on('seen_log')
    .columns(['chain_id', 'block_number'])
    .execute();

  await sql.raw(getConstructionPlans(PGBOSS_SCHEMA)).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS ${sql.raw(PGBOSS_SCHEMA)} CASCADE`.execute(db);
  await db.schema.dropIndex('seen_log_chain_block_idx').execute();
  await db.schema.dropTable('seen_log').execute();
}
