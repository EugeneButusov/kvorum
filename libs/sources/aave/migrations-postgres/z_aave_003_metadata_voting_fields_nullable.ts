import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('aave_proposal_metadata')
    .alterColumn('voting_machine_address', (column) => column.dropNotNull())
    .execute();

  await db.schema
    .alterTable('aave_proposal_metadata')
    .alterColumn('voting_chain_id', (column) => column.dropNotNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('aave_proposal_metadata')
    .alterColumn('voting_machine_address', (column) => column.setNotNull())
    .execute();

  await db.schema
    .alterTable('aave_proposal_metadata')
    .alterColumn('voting_chain_id', (column) => column.setNotNull())
    .execute();
}
