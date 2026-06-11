import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('voting_power_snapshot_run')
    .dropColumn('sample_size')
    .dropColumn('fallback_engaged')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('voting_power_snapshot_run')
    .addColumn('sample_size', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('fallback_engaged', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();

  await sql`
    UPDATE voting_power_snapshot_run
    SET sample_size = 0,
        fallback_engaged = false
    WHERE sample_size IS NULL OR fallback_engaged IS NULL
  `.execute(db);
}
