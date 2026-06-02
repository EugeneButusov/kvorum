import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('aave_proposal_metadata')
    .addColumn('last_reconcile_check_block', 'bigint')
    .execute();

  await db.schema
    .createIndex('idx_aave_proposal_metadata_recheck')
    .on('aave_proposal_metadata')
    .column('last_reconcile_check_block')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_aave_proposal_metadata_recheck').execute();

  await db.schema
    .alterTable('aave_proposal_metadata')
    .dropColumn('last_reconcile_check_block')
    .execute();
}
