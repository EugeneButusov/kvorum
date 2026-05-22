import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE delegation_event_type AS ENUM ('delegate_changed', 'votes_changed')
  `.execute(db);

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
    .createTable('vote')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('proposal_id', 'uuid', (col) =>
      col.notNull().references('proposal.id').onDelete('restrict'),
    )
    .addColumn('voter_actor_id', 'uuid', (col) =>
      col.notNull().references('actor.id').onDelete('restrict'),
    )
    .addColumn('voting_power_reported', sql`numeric(78,0)`, (col) => col.notNull())
    .addColumn('voting_power_computed', sql`numeric(78,0)`)
    .addColumn('voting_power_verified', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('voting_power_discrepancy', sql`numeric(78,0)`)
    .addColumn('cast_at', 'timestamptz', (col) => col.notNull())
    .addColumn('block_number', 'bigint')
    .addColumn('tx_hash', 'text')
    .addColumn('log_index', 'integer')
    .addColumn('source_id', 'text')
    .addColumn('reason', 'text')
    .addColumn('primary_choice', 'smallint')
    .addColumn('superseded_by_vote_id', 'uuid', (col) =>
      col.references('vote.id').onDelete('restrict'),
    )
    .addColumn('superseded_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('vote_choice')
    .addColumn('vote_id', 'uuid', (col) => col.notNull().references('vote.id').onDelete('cascade'))
    .addColumn('choice_index', 'smallint', (col) => col.notNull())
    .addColumn('weight', sql`numeric(20,18)`, (col) => col.notNull().defaultTo(sql`1.0`))
    .addPrimaryKeyConstraint('vote_choice_pkey', ['vote_id', 'choice_index'])
    .execute();

  await db.schema
    .createTable('delegation')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dao_id', 'uuid', (col) => col.notNull().references('dao.id').onDelete('restrict'))
    .addColumn('delegator_actor_id', 'uuid', (col) =>
      col.notNull().references('actor.id').onDelete('restrict'),
    )
    .addColumn('delegate_actor_id', 'uuid', (col) =>
      col.references('actor.id').onDelete('restrict'),
    )
    .addColumn('voting_power', sql`numeric(78,0)`, (col) => col.notNull())
    .addColumn('block_number', 'bigint', (col) => col.notNull())
    .addColumn('tx_hash', 'text', (col) => col.notNull())
    .addColumn('event_type', sql`delegation_event_type`, (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('voting_power_snapshot')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('actor_id', 'uuid', (col) =>
      col.notNull().references('actor.id').onDelete('restrict'),
    )
    .addColumn('dao_id', 'uuid', (col) => col.notNull().references('dao.id').onDelete('restrict'))
    .addColumn('proposal_id', 'uuid', (col) =>
      col.notNull().references('proposal.id').onDelete('restrict'),
    )
    .addColumn('block_number', 'bigint', (col) => col.notNull())
    .addColumn('power', sql`numeric(78,0)`, (col) => col.notNull())
    .addColumn('computed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('voting_power_snapshot_actor_proposal_uidx', ['actor_id', 'proposal_id'])
    .execute();

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

  await db.schema
    .alterTable('archive_confirmation')
    .addColumn('derivation_actor_resolved_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('archive_confirmation')
    .addColumn('actor_resolution_attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex('vote_proposal_id_cast_at_idx')
    .on('vote')
    .columns(['proposal_id', 'cast_at desc'])
    .execute();
  await db.schema
    .createIndex('vote_voter_actor_id_cast_at_idx')
    .on('vote')
    .columns(['voter_actor_id', 'cast_at desc'])
    .execute();
  await sql`
    CREATE UNIQUE INDEX vote_proposal_voter_current_uidx
    ON vote (proposal_id, voter_actor_id)
    WHERE superseded_by_vote_id IS NULL
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX vote_event_idempotency_uidx
    ON vote (proposal_id, tx_hash, log_index)
    WHERE tx_hash IS NOT NULL
  `.execute(db);

  await db.schema
    .createIndex('delegation_delegator_actor_block_idx')
    .on('delegation')
    .columns(['delegator_actor_id', 'block_number desc'])
    .execute();
  await db.schema
    .createIndex('delegation_delegate_actor_block_idx')
    .on('delegation')
    .columns(['delegate_actor_id', 'block_number desc'])
    .execute();
  await db.schema
    .createIndex('delegation_dao_block_idx')
    .on('delegation')
    .columns(['dao_id', 'block_number desc'])
    .execute();

  await db.schema
    .createIndex('voting_power_snapshot_proposal_idx')
    .on('voting_power_snapshot')
    .column('proposal_id')
    .execute();

  await sql`
    CREATE UNIQUE INDEX actor_address_primary_uidx
    ON actor_address (address)
    WHERE is_primary = true
  `.execute(db);

  await sql`
    CREATE INDEX idx_actor_merged_into
    ON actor (merged_into_actor_id)
    WHERE merged_into_actor_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_archive_confirmation_l0_pending
    ON archive_confirmation (dao_source_id)
    WHERE confirmation_status = 'confirmed' AND derivation_actor_resolved_at IS NULL
  `.execute(db);

  await sql`
    INSERT INTO actor_address (actor_id, address, is_primary, source)
    SELECT id, primary_address, true, 'm1_backfill'
    FROM actor
    ON CONFLICT DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_archive_confirmation_l0_pending').execute();
  await db.schema.dropIndex('idx_actor_merged_into').execute();

  await db.schema.alterTable('actor').dropColumn('merged_into_actor_id').execute();
  await db.schema
    .alterTable('archive_confirmation')
    .dropColumn('actor_resolution_attempt_count')
    .execute();
  await db.schema
    .alterTable('archive_confirmation')
    .dropColumn('derivation_actor_resolved_at')
    .execute();

  await db.schema.dropTable('actor_address_redirect').execute();
  await db.schema.dropTable('actor_address').execute();
  await db.schema.dropTable('voting_power_snapshot').execute();
  await db.schema.dropTable('vote_choice').execute();
  await db.schema.dropTable('vote').execute();
  await db.schema.dropTable('delegation').execute();
  await db.schema.dropTable('actor_address_source').execute();

  await sql`DROP TYPE delegation_event_type`.execute(db);
}
