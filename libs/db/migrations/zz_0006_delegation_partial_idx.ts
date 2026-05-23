import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX delegation_delegator_actor_block_delegate_changed_idx
    ON delegation (delegator_actor_id, block_number DESC)
    WHERE event_type = 'delegate_changed'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('delegation_delegator_actor_block_delegate_changed_idx').execute();
}
