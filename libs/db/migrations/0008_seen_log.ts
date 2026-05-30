import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('seen_log')
    .addColumn('chain_id', 'varchar(32)', (col) => col.notNull())
    .addColumn('tx_hash', 'text', (col) => col.notNull())
    .addColumn('log_index', 'integer', (col) => col.notNull())
    .addColumn('block_number', 'bigint', (col) => col.notNull())
    .addPrimaryKeyConstraint('seen_log_pkey', ['chain_id', 'tx_hash', 'log_index'])
    .execute();

  // Supports the block-height prune DELETE (chain_id = ? AND block_number < ?)
  await db.schema
    .createIndex('seen_log_chain_block_idx')
    .on('seen_log')
    .columns(['chain_id', 'block_number'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('seen_log_chain_block_idx').execute();
  await db.schema.dropTable('seen_log').execute();
}
