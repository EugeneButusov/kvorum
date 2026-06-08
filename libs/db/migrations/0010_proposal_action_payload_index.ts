import type { Kysely } from 'kysely';
import { sql } from 'kysely';

const LEGACY_CONSTRAINT = 'proposal_action_proposal_id_action_index_key';
const PAYLOAD_CONSTRAINT = 'proposal_action_proposal_id_payload_index_action_index_key';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('proposal_action')
    .addColumn('payload_index', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await sql`
    ALTER TABLE proposal_action
    DROP CONSTRAINT ${sql.id(LEGACY_CONSTRAINT)}
  `.execute(db);

  await db.schema
    .alterTable('proposal_action')
    .addUniqueConstraint(PAYLOAD_CONSTRAINT, ['proposal_id', 'payload_index', 'action_index'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE proposal_action
    DROP CONSTRAINT ${sql.id(PAYLOAD_CONSTRAINT)}
  `.execute(db);

  await db.schema.alterTable('proposal_action').dropColumn('payload_index').execute();

  await db.schema
    .alterTable('proposal_action')
    .addUniqueConstraint(LEGACY_CONSTRAINT, ['proposal_id', 'action_index'])
    .execute();
}
