import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`INSERT INTO source_type (value) VALUES ('compound_governor_bravo')`.execute(db);
  await sql`INSERT INTO source_type (value) VALUES ('compound_governor_alpha')`.execute(db);

  await db.schema
    .createTable('compound_proposal_meta')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.primaryKey().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('queued_at_block', 'bigint')
    .addColumn('last_reconcile_check_block', 'bigint')
    .execute();

  await db.schema
    .createIndex('idx_compound_proposal_meta_recheck')
    .on('compound_proposal_meta')
    .column('last_reconcile_check_block')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('compound_proposal_meta').execute();
  await sql`DELETE FROM source_type WHERE value = 'compound_governor_alpha'`.execute(db);
  await sql`DELETE FROM source_type WHERE value = 'compound_governor_bravo'`.execute(db);
}
