import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('proposal')
    .addColumn('eligible_voting_power', sql`numeric(78, 0)`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('proposal').dropColumn('eligible_voting_power').execute();
}
