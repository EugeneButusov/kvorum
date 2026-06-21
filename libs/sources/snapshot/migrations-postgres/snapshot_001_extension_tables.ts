import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`INSERT INTO source_type (value) VALUES ('snapshot') ON CONFLICT DO NOTHING`.execute(db);

  await db.schema
    .createTable('snapshot_proposal_metadata')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.primaryKey().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('space_id', 'text', (col) => col.notNull())
    .addColumn('voting_type', 'text')
    .addColumn('strategies', 'jsonb')
    .addColumn('ipfs_hash', 'text')
    .addColumn('network', 'text')
    .addColumn('scores_state', 'text')
    .addColumn('flagged', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('snapshot_proposal_metadata').execute();
  await sql`DELETE FROM source_type WHERE value = 'snapshot'`.execute(db);
}
