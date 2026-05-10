import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`INSERT INTO source_type (value) VALUES ('compound_governor')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM source_type WHERE value = 'compound_governor'`.execute(db);
}
