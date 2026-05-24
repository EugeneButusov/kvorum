import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/** Destructive migration for pre-production refactor.
 *  Drops reorg/status machinery and renames archive_confirmation -> archive_event. */
export async function up(db: Kysely<unknown>): Promise<void> {
  // §13.D — rename DLQ stage before dropping the old table so existing rows are visible
  await sql`UPDATE ingestion_dlq          SET stage = 'archive_event_stage' WHERE stage = 'confirmation_archive_stage'`.execute(
    db,
  );
  await sql`UPDATE ingestion_dlq_resolved SET stage = 'archive_event_stage' WHERE stage = 'confirmation_archive_stage'`.execute(
    db,
  );

  await db.schema
    .alterTable('archive_confirmation')
    .dropColumn('orphaned_by_reorg_event_id')
    .execute();

  await db.schema.dropIndex('idx_reorg_event_chain_id_detected_at').ifExists().execute();
  await db.schema.dropTable('reorg_event').ifExists().execute();

  // Drop indexes before dropping the columns they depend on
  await db.schema
    .dropIndex('idx_archive_confirmation_actor_resolution_pending')
    .ifExists()
    .execute();
  await db.schema.dropIndex('idx_archive_confirmation_canonical').ifExists().execute();
  await db.schema.dropIndex('idx_archive_confirmation_promotion_sweep').ifExists().execute();
  await db.schema.dropIndex('idx_archive_confirmation_dao_source').ifExists().execute();
  await db.schema.dropIndex('idx_archive_confirmation_g1_watermark').ifExists().execute();

  await db.schema
    .alterTable('archive_confirmation')
    .dropColumn('confirmation_status')
    .dropColumn('confirmed_at')
    .dropColumn('orphaned_at')
    .execute();

  await db.schema
    .alterTable('archive_confirmation')
    .dropConstraint('archive_confirmation_idempotency_key')
    .execute();

  await sql`
    CREATE UNIQUE INDEX archive_event_idempotency_key
    ON archive_confirmation (source_type, chain_id, tx_hash, log_index)
  `.execute(db);

  await sql`
    CREATE INDEX idx_archive_event_underived
    ON archive_confirmation (dao_source_id)
    WHERE derived_at IS NULL
  `.execute(db);

  await db.schema.alterTable('archive_confirmation').renameTo('archive_event').execute();

  // Recreate actor_resolution index with new name and simplified WHERE clause (no confirmation_status)
  await sql`
    CREATE INDEX idx_archive_event_actor_resolution_pending
    ON archive_event (dao_source_id)
    WHERE derivation_actor_resolved_at IS NULL
  `.execute(db);

  await sql`DROP TYPE confirmation_status`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE confirmation_status AS ENUM ('pending', 'confirmed', 'orphaned')`.execute(
    db,
  );

  await db.schema.alterTable('archive_event').renameTo('archive_confirmation').execute();

  await db.schema.dropIndex('idx_archive_event_underived').ifExists().execute();
  await db.schema.dropIndex('idx_archive_event_actor_resolution_pending').ifExists().execute();
  await db.schema.dropIndex('archive_event_idempotency_key').ifExists().execute();

  await db.schema
    .alterTable('archive_confirmation')
    .addColumn('confirmation_status', sql`confirmation_status`, (col) =>
      col.notNull().defaultTo('confirmed'),
    )
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('orphaned_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('archive_confirmation')
    .addColumn('orphaned_by_reorg_event_id', 'uuid')
    .execute();

  await db.schema
    .createTable('reorg_event')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('chain_id', sql`varchar(32)`, (col) => col.notNull())
    .addColumn('detected_at', 'timestamptz', (col) => col.notNull())
    .addColumn('divergence_block_number', 'bigint', (col) => col.notNull())
    .addColumn('orphaned_block_hashes', sql`text[]`, (col) => col.notNull())
    .addColumn('canonical_block_hashes', sql`text[]`, (col) => col.notNull())
    .addColumn('notes', 'text')
    .execute();

  await db.schema
    .createIndex('idx_reorg_event_chain_id_detected_at')
    .on('reorg_event')
    .columns(['chain_id', 'detected_at desc'])
    .execute();

  await db.schema
    .alterTable('archive_confirmation')
    .addForeignKeyConstraint(
      'archive_confirmation_orphaned_by_reorg_event_id_fkey',
      ['orphaned_by_reorg_event_id'],
      'reorg_event',
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .alterTable('archive_confirmation')
    .addUniqueConstraint('archive_confirmation_idempotency_key', [
      'source_type',
      'chain_id',
      'tx_hash',
      'log_index',
      'block_hash',
    ])
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_archive_confirmation_canonical
    ON archive_confirmation (source_type, chain_id, tx_hash, log_index)
    WHERE confirmation_status <> 'orphaned'
  `.execute(db);

  await db.schema
    .createIndex('idx_archive_confirmation_promotion_sweep')
    .on('archive_confirmation')
    .columns(['confirmation_status', 'block_number'])
    .execute();

  await db.schema
    .createIndex('idx_archive_confirmation_dao_source')
    .on('archive_confirmation')
    .columns(['dao_source_id', 'confirmation_status'])
    .execute();

  await sql`
    CREATE INDEX idx_archive_confirmation_g1_watermark
    ON archive_confirmation (dao_source_id)
    WHERE confirmation_status = 'confirmed' AND derived_at IS NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_archive_confirmation_actor_resolution_pending
    ON archive_confirmation (dao_source_id)
    WHERE confirmation_status = 'confirmed' AND derivation_actor_resolved_at IS NULL
  `.execute(db);
}
