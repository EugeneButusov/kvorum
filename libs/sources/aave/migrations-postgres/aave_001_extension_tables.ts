import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE aave_payload_status AS ENUM ('declared', 'created', 'queued', 'executed', 'cancelled', 'expired')`.execute(
    db,
  );

  await db.schema
    .createTable('aave_proposal_metadata')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.primaryKey().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('voting_chain_id', sql`varchar(32)`, (col) => col.notNull())
    .addColumn('voting_machine_address', 'text', (col) => col.notNull())
    .addColumn('voting_strategy_address', 'text')
    .addColumn('snapshot_block_hash', 'text')
    .addColumn('snapshot_block_number_l1', 'bigint')
    .addColumn('creation_block', 'bigint', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('aave_proposal_payload')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('proposal_id', 'uuid', (col) =>
      col.notNull().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('payload_index', 'integer', (col) => col.notNull())
    .addColumn('target_chain_id', sql`varchar(32)`, (col) => col.notNull())
    .addColumn('payloads_controller_address', 'text', (col) => col.notNull())
    .addColumn('payload_id', 'bigint', (col) => col.notNull())
    .addColumn('status', sql`aave_payload_status`, (col) => col.notNull().defaultTo('declared'))
    .addColumn('executed_at_destination', 'timestamptz')
    .addColumn('bridge_message_id', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('aave_proposal_payload_proposal_id_payload_index_key', [
      'proposal_id',
      'payload_index',
    ])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('aave_proposal_payload').execute();
  await db.schema.dropTable('aave_proposal_metadata').execute();
  await sql`DROP TYPE aave_payload_status`.execute(db);
}
