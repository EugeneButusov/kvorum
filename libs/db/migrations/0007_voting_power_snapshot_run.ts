import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE voting_power_snapshot_run_status AS ENUM ('in_progress', 'completed', 'failed')
  `.execute(db);

  await db.schema
    .createTable('voting_power_snapshot_run')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.primaryKey().notNull().references('proposal.id').onDelete('restrict'),
    )
    .addColumn('voting_power_block', 'bigint', (col) => col.notNull())
    .addColumn('status', sql`voting_power_snapshot_run_status`, (col) => col.notNull())
    .addColumn('snapshot_attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('last_attempt_at', 'timestamptz')
    .addColumn('rows_inserted', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('population_size', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('sample_size', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('fallback_engaged', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    .addColumn('completed_at', 'timestamptz')
    .execute();

  await sql`
    CREATE INDEX idx_voting_power_snapshot_run_in_progress
    ON voting_power_snapshot_run (proposal_id)
    WHERE status = 'in_progress'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_voting_power_snapshot_run_in_progress').execute();
  await db.schema.dropTable('voting_power_snapshot_run').execute();
  await sql`DROP TYPE voting_power_snapshot_run_status`.execute(db);
}
