import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE source_type
    SET reconcilable = true
    WHERE value = 'compound_governor_bravo'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE source_type
    SET reconcilable = false
    WHERE value = 'compound_governor_bravo'
  `.execute(db);
}
