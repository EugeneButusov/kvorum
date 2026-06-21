import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`INSERT INTO source_type (value) VALUES ('aragon_voting') ON CONFLICT DO NOTHING`.execute(
    db,
  );

  await db.schema
    .createTable('aragon_proposal_metadata')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.primaryKey().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('app_address', 'text', (col) => col.notNull())
    .addColumn('app_version', 'text')
    .addColumn('support_required_pct', 'numeric')
    .addColumn('min_accept_quorum_pct', 'numeric')
    .addColumn('main_phase_ends_at', 'timestamptz')
    .addColumn('objection_phase_ends_at', 'timestamptz')
    .addColumn('executed_at', 'timestamptz')
    .addColumn('last_reconcile_check_block', 'bigint')
    .execute();

  await db.schema
    .createIndex('idx_aragon_proposal_metadata_recheck')
    .on('aragon_proposal_metadata')
    .column('last_reconcile_check_block')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_aragon_proposal_metadata_recheck').execute();
  await db.schema.dropTable('aragon_proposal_metadata').execute();
  await sql`DELETE FROM source_type WHERE value = 'aragon_voting'`.execute(db);
}
