import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('delegation')
    .addColumn('tx_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('log_index', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .alterTable('vote')
    .addColumn('tx_index', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex('idx_delegation_dao_block_ordering')
    .on('delegation')
    .columns(['dao_id', 'block_number', 'tx_index', 'log_index'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_delegation_dao_block_ordering').execute();

  await db.schema.alterTable('vote').dropColumn('tx_index').execute();

  await db.schema.alterTable('delegation').dropColumn('log_index').dropColumn('tx_index').execute();
}
