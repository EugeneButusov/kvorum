import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── source_type reference table ──────────────────────────────────────────────
  // Values are injected by each source package's own migrations-postgres migration
  // (e.g. libs/sources/compound/migrations-postgres/compound_001_schema.ts).
  // Using a reference table instead of an enum keeps DDL fully transactional and
  // lets sources self-register without touching core migrations.
  await db.schema
    .createTable('source_type')
    .addColumn('value', 'text', (col) => col.primaryKey())
    .execute();

  // ── Enum types ──────────────────────────────────────────────────────────────
  await sql`
    CREATE TYPE proposal_state AS ENUM (
      'pending', 'active', 'succeeded', 'defeated', 'queued', 'executed', 'canceled', 'expired', 'vetoed'
    )
  `.execute(db);

  await sql`
    CREATE TYPE decode_status AS ENUM ('pending', 'decoded', 'undecodable')
  `.execute(db);

  // ── dao ─────────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('dao')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('primary_token_address', 'text', (col) => col.notNull())
    .addColumn('primary_chain_id', sql`varchar(32)`, (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addColumn('website_url', 'text', (col) => col.notNull())
    .addColumn('forum_url', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull())
    .execute();

  // ── dao_source ───────────────────────────────────────────────────────────────
  await db.schema
    .createTable('dao_source')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dao_id', 'uuid', (col) => col.notNull().references('dao.id').onDelete('restrict'))
    .addColumn('source_type', 'text', (col) =>
      col.notNull().references('source_type.value').onDelete('restrict'),
    )
    .addColumn('chain_id', sql`varchar(32)`, (col) => col.notNull())
    .addColumn('source_config', 'jsonb', (col) => col.notNull())
    .addColumn('active_from_block', 'bigint')
    .addColumn('active_to_block', 'bigint')
    .addColumn('backfill_started_at_block', 'bigint')
    .addColumn('backfill_head_block', 'bigint')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('dao_source_dao_id_source_type_chain_id_key', [
      'dao_id',
      'source_type',
      'chain_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_dao_source_dao_id_source_type')
    .on('dao_source')
    .columns(['dao_id', 'source_type'])
    .execute();

  // ── actor ────────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('actor')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('primary_address', 'text', (col) =>
      col
        .notNull()
        .unique()
        .check(sql`primary_address = lower(primary_address)`),
    )
    .addColumn('display_name', 'text')
    .addColumn('bio', 'text')
    .addColumn('profile_data', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull())
    .execute();

  // ── proposal ─────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('proposal')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dao_id', 'uuid', (col) => col.notNull().references('dao.id').onDelete('restrict'))
    .addColumn('source_type', 'text', (col) =>
      col.notNull().references('source_type.value').onDelete('restrict'),
    )
    .addColumn('source_id', 'text', (col) => col.notNull())
    .addColumn('proposer_actor_id', 'uuid', (col) =>
      col.notNull().references('actor.id').onDelete('restrict'),
    )
    .addColumn('title', 'text')
    .addColumn('description', 'text', (col) => col.notNull())
    .addColumn('description_hash', 'text', (col) => col.notNull())
    .addColumn('binding', 'boolean', (col) => col.notNull())
    .addColumn('voting_starts_at', 'timestamptz')
    .addColumn('voting_ends_at', 'timestamptz')
    .addColumn('voting_starts_block', 'bigint')
    .addColumn('voting_ends_block', 'bigint')
    .addColumn('state', sql`proposal_state`, (col) => col.notNull())
    .addColumn('state_updated_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull())
    .addUniqueConstraint('proposal_dao_id_source_type_source_id_key', [
      'dao_id',
      'source_type',
      'source_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_proposal_dao_list')
    .on('proposal')
    .columns(['dao_id', 'state', 'voting_starts_at desc', 'id desc'])
    .execute();

  await db.schema
    .createIndex('idx_proposal_cross_dao_list')
    .on('proposal')
    .columns(['state', 'voting_starts_at desc', 'id desc'])
    .execute();

  await db.schema
    .createIndex('idx_proposal_proposer_actor_id')
    .on('proposal')
    .columns(['proposer_actor_id'])
    .execute();

  await db.schema
    .createIndex('idx_proposal_voting_starts_block')
    .on('proposal')
    .column('voting_starts_block')
    .execute();

  await sql`
    CREATE INDEX idx_proposal_pending_timestamp_fill
    ON proposal (voting_starts_block)
    WHERE voting_starts_at IS NULL OR voting_ends_at IS NULL
  `.execute(db);

  // Supports the M5-1.4 AI trigger scan: `WHERE state IN (...) AND state_updated_at >= cutoff`.
  await db.schema
    .createIndex('idx_proposal_state_updated_at')
    .on('proposal')
    .columns(['state', 'state_updated_at desc'])
    .execute();

  // ── proposal_action ──────────────────────────────────────────────────────────
  await db.schema
    .createTable('proposal_action')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('proposal_id', 'uuid', (col) =>
      col.notNull().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('payload_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('action_index', 'integer', (col) => col.notNull())
    .addColumn('target_address', 'text', (col) => col.notNull())
    .addColumn('target_chain_id', sql`varchar(32)`, (col) => col.notNull())
    .addColumn('value_wei', sql`numeric(78, 0)`, (col) => col.notNull())
    .addColumn('function_signature', 'text')
    .addColumn('calldata', 'text', (col) => col.notNull())
    .addColumn('decoded_function', 'text')
    .addColumn('decoded_arguments', 'jsonb')
    .addColumn('decode_status', sql`decode_status`, (col) => col.notNull().defaultTo('pending'))
    .addColumn('decode_attempted_at', 'timestamptz')
    .addColumn('decode_attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('next_decode_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('proposal_action_proposal_id_payload_index_action_index_key', [
      'proposal_id',
      'payload_index',
      'action_index',
    ])
    .execute();

  await db.schema
    .createIndex('idx_proposal_action_pending_decode')
    .on('proposal_action')
    .columns(['next_decode_at', 'created_at'])
    .where(sql`decode_status = 'pending'`)
    .execute();

  // ── proposal_choice ──────────────────────────────────────────────────────────
  await db.schema
    .createTable('proposal_choice')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.notNull().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('choice_index', 'integer', (col) => col.notNull())
    .addColumn('value', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('proposal_choice_pkey', ['proposal_id', 'choice_index'])
    .execute();

  // ── archive_event ────────────────────────────────────────────────────────────
  await db.schema
    .createTable('archive_event')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('source_type', 'text', (col) =>
      col.notNull().references('source_type.value').onDelete('restrict'),
    )
    .addColumn('dao_source_id', 'uuid', (col) =>
      col.notNull().references('dao_source.id').onDelete('restrict'),
    )
    .addColumn('chain_id', sql`varchar(32)`, (col) => col.notNull())
    // Block/tx coords are non-null for EVM rows and null for off-chain rows
    // (identified by external_id). The identity-shape CHECK below enforces exactly
    // one shape; the sentinel chain_id 'off-chain' marks blockless sources (ADR-071).
    .addColumn('block_number', 'bigint')
    .addColumn('block_hash', 'text')
    .addColumn('tx_hash', 'text')
    .addColumn('log_index', 'integer')
    .addColumn('external_id', 'text')
    // Off-chain ordering key: the source-native ordinal (e.g. Snapshot proposal/vote
    // `created`) that gives blockless rows a deterministic derivation order, since
    // (block_number, log_index) is degenerate off-chain. NULL for EVM rows (which
    // order by block coords). Populated by the off-chain consumer; value semantics
    // are defined in ADR-072.
    .addColumn('derivation_ordinal', 'bigint')
    // Mutable-latest fields for off-chain rows (ADR-071 §off-chain consumer):
    // content_hash = hash of the latest archived payload slice; version = PG-maintained
    // monotonic counter bumped only when content_hash changes, used as the CH
    // ReplacingMergeTree(version) sort key so the latest edit wins deterministically.
    // Both NULL for EVM rows (append-only, no edits).
    .addColumn('content_hash', 'text')
    .addColumn('version', 'integer')
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('received_at', 'timestamptz', (col) => col.notNull())
    .addColumn('derived_at', 'timestamptz')
    .addColumn('derivation_actor_resolved_at', 'timestamptz')
    .addColumn('derivation_attempt_count', 'smallint', (col) => col.notNull().defaultTo(0))
    .addColumn('actor_resolution_attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addCheckConstraint(
      'archive_event_identity_shape',
      sql`(external_id IS NULL
             AND block_number IS NOT NULL AND block_hash IS NOT NULL
             AND tx_hash IS NOT NULL AND log_index IS NOT NULL)
          OR
          (external_id IS NOT NULL
             AND block_number IS NULL AND block_hash IS NULL
             AND tx_hash IS NULL AND log_index IS NULL)`,
    )
    .execute();

  // Two partial unique indexes, one per identity shape: EVM rows key on the 4-tuple,
  // off-chain rows key on external_id.
  await sql`
    CREATE UNIQUE INDEX archive_event_idempotency_key
    ON archive_event (source_type, chain_id, tx_hash, log_index)
    WHERE external_id IS NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX archive_event_external_id_key
    ON archive_event (source_type, chain_id, external_id)
    WHERE external_id IS NOT NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_archive_event_underived')
    .on('archive_event')
    .columns(['dao_source_id'])
    .where(sql`derived_at IS NULL`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('archive_event').execute();
  await db.schema.dropTable('proposal_choice').execute();
  await db.schema.dropTable('proposal_action').execute();
  await db.schema.dropTable('proposal').execute();
  await db.schema.dropTable('actor').execute();
  await db.schema.dropTable('dao_source').execute();
  await db.schema.dropTable('dao').execute();
  await db.schema.dropTable('source_type').execute();

  await sql`DROP TYPE proposal_state`.execute(db);
  await sql`DROP TYPE decode_status`.execute(db);
}
