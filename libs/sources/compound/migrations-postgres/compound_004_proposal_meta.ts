import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('compound_proposal_meta')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.primaryKey().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('queued_block', 'bigint')
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
}
