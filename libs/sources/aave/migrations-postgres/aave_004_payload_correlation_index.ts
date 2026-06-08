import type { Kysely } from 'kysely';

const INDEX_NAME = 'aave_proposal_payload_correlation_key';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex(INDEX_NAME)
    .on('aave_proposal_payload')
    .columns(['target_chain_id', 'payloads_controller_address', 'payload_id'])
    .unique()
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex(INDEX_NAME).execute();
}
