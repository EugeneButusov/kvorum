import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('reconciliation_watermark')
    .addColumn('sweep_name', 'text', (col) => col.notNull())
    .addColumn('dao_source_id', 'uuid', (col) =>
      col.notNull().references('dao_source.id').onDelete('restrict'),
    )
    .addColumn('last_swept_block_number', 'bigint', (col) => col.notNull().defaultTo('0'))
    .addColumn('last_swept_tx_hash', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('last_swept_log_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_sweep_at', 'timestamptz')
    .addPrimaryKeyConstraint('reconciliation_watermark_pk', ['sweep_name', 'dao_source_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('reconciliation_watermark').execute();
}
