import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`INSERT INTO source_type (value) VALUES ('compound_governor')`.execute(db);
  await sql`INSERT INTO source_type (value) VALUES ('compound_governor_alpha')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM source_type WHERE value = 'compound_governor_alpha'`.execute(db);
  await sql`DELETE FROM source_type WHERE value = 'compound_governor'`.execute(db);
}
