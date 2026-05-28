import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('actor_address_source')
    .addColumn('name', 'text', (col) => col.primaryKey())
    .execute();

  await sql`
    INSERT INTO actor_address_source (name)
    VALUES
      ('proposer_event'),
      ('voter_event'),
      ('delegator_event'),
      ('delegate_event'),
      ('manual'),
      ('m1_backfill')
  `.execute(db);

  await db.schema
    .createTable('actor_address')
    .addColumn('actor_id', 'uuid', (col) =>
      col.notNull().references('actor.id').onDelete('restrict'),
    )
    .addColumn('address', 'text', (col) =>
      col
        .notNull()
        .check(
          sql`address = lower(address) AND length(address) = 42 AND starts_with(address, '0x')`,
        ),
    )
    .addColumn('is_primary', 'boolean', (col) => col.notNull())
    .addColumn('source', 'text', (col) =>
      col.notNull().references('actor_address_source.name').onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('actor_address_pkey', ['actor_id', 'address'])
    .execute();

  await db.schema
    .createTable('actor_address_redirect')
    .addColumn('from_address', 'text', (col) =>
      col
        .primaryKey()
        .notNull()
        .check(
          sql`from_address = lower(from_address) AND length(from_address) = 42 AND starts_with(from_address, '0x')`,
        ),
    )
    .addColumn('to_actor_id', 'uuid', (col) =>
      col.notNull().references('actor.id').onDelete('restrict'),
    )
    .addColumn('merged_at', 'timestamptz', (col) => col.notNull())
    .addColumn('merge_reason', 'text', (col) => col.notNull())
    .addColumn('created_by', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .alterTable('actor')
    .addColumn('merged_into_actor_id', 'uuid', (col) =>
      col.references('actor.id').onDelete('restrict'),
    )
    .execute();

  await sql`
    CREATE UNIQUE INDEX actor_address_primary_uidx
    ON actor_address (address)
    WHERE is_primary = true
  `.execute(db);

  await sql`
    CREATE INDEX actor_address_address_idx
    ON actor_address (address)
  `.execute(db);

  await sql`
    CREATE INDEX idx_actor_merged_into
    ON actor (merged_into_actor_id)
    WHERE merged_into_actor_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_archive_event_actor_resolution_pending
    ON archive_event (dao_source_id)
    WHERE derivation_actor_resolved_at IS NULL
  `.execute(db);

  await sql`
    INSERT INTO actor_address (actor_id, address, is_primary, source)
    SELECT id, primary_address, true, 'm1_backfill'
    FROM actor
    ON CONFLICT DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_archive_event_actor_resolution_pending').execute();
  await db.schema.dropIndex('actor_address_address_idx').execute();
  await db.schema.dropIndex('idx_actor_merged_into').execute();

  await db.schema.alterTable('actor').dropColumn('merged_into_actor_id').execute();
  await db.schema.dropTable('actor_address_redirect').execute();
  await db.schema.dropTable('actor_address').execute();
  await db.schema.dropTable('actor_address_source').execute();
}
