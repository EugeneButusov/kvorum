import type { Kysely } from 'kysely';
import { sql } from 'kysely';
// getConstructionPlans/getMigrationPlans are module-level named exports — NOT static PgBoss.*
// methods. PgBoss.getConstructionPlans is undefined at runtime; the named import is the API.
// A future pg-boss version bump that ships a schema change needs a new migration emitting
// getMigrationPlans(schema, version) SQL; boot with migrate:false will verify and throw if stale.
import { getConstructionPlans } from 'pg-boss';

const PGBOSS_SCHEMA = 'pgboss';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(getConstructionPlans(PGBOSS_SCHEMA)).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS ${sql.raw(PGBOSS_SCHEMA)} CASCADE`.execute(db);
}
