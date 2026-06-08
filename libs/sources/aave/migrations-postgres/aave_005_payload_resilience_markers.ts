import type { Kysely } from 'kysely';
import { sql } from 'kysely';

const PAYLOAD_RECHECK_INDEX = 'idx_aave_proposal_payload_recheck';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('aave_proposal_payload')
    .addColumn('unindexed_target_chain', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('last_reconcile_check_block', 'bigint')
    .execute();

  await db.schema
    .createIndex(PAYLOAD_RECHECK_INDEX)
    .on('aave_proposal_payload')
    .column('last_reconcile_check_block')
    .where(sql<boolean>`status in ('created', 'queued')`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex(PAYLOAD_RECHECK_INDEX).execute();
  await db.schema
    .alterTable('aave_proposal_payload')
    .dropColumn('last_reconcile_check_block')
    .dropColumn('unindexed_target_chain')
    .execute();
}
