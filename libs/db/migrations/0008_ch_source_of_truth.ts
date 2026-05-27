import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX actor_address_address_idx
    ON actor_address (address)
  `.execute(db);

  await sql`
    CREATE VIEW actor_redirect_view AS
    SELECT
      aa.address,
      aa.actor_id AS current_actor_id
    FROM actor_address aa
    UNION ALL
    SELECT
      r.from_address AS address,
      r.to_actor_id AS current_actor_id
    FROM actor_address_redirect r
    WHERE NOT EXISTS (
      SELECT 1 FROM actor_address aa WHERE aa.address = r.from_address
    )
  `.execute(db);

  await sql`
    CREATE INDEX archive_event_undelivered_idx
    ON archive_event (received_at)
    WHERE derived_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('archive_event_undelivered_idx').execute();
  await db.schema.dropView('actor_redirect_view').execute();
  await db.schema.dropIndex('actor_address_address_idx').execute();
}
