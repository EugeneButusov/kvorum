import type { Kysely } from 'kysely';
import { sql } from 'kysely';

const EPOCH = new Date('1970-01-01T00:00:00.000Z');

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('etl_watermark')
    .addColumn('name', 'text', (col) => col.primaryKey())
    .addColumn('watermark', 'timestamptz', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db
    .insertInto('etl_watermark')
    .values([
      { name: 'vote_events_etl', watermark: EPOCH },
      { name: 'delegation_flow_etl', watermark: EPOCH },
    ])
    .execute();

  await sql`
    CREATE TYPE mirror_etl_run_status AS ENUM ('in_progress', 'completed', 'failed')
  `.execute(db);

  await db.schema
    .createTable('mirror_etl_run')
    .addColumn('job_name', 'text', (col) => col.notNull())
    .addColumn('watermark_from', 'timestamptz', (col) => col.notNull())
    .addColumn('watermark_to', 'timestamptz', (col) => col.notNull())
    .addColumn('status', sql`mirror_etl_run_status`, (col) => col.notNull())
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('rows_written', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('exact_match', 'boolean')
    .addColumn('drift_ratio', sql`double precision`)
    .addColumn('last_error', 'text')
    .addColumn('started_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .addPrimaryKeyConstraint('mirror_etl_run_pk', ['job_name', 'watermark_from'])
    .execute();

  await sql`
    CREATE INDEX idx_mirror_etl_run_in_progress
    ON mirror_etl_run (job_name, started_at DESC)
    WHERE status = 'in_progress'
  `.execute(db);

  await sql`
    CREATE INDEX idx_mirror_etl_run_completed
    ON mirror_etl_run (job_name, completed_at DESC)
    WHERE status = 'completed'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_mirror_etl_run_completed').execute();
  await db.schema.dropIndex('idx_mirror_etl_run_in_progress').execute();
  await db.schema.dropTable('mirror_etl_run').execute();
  await sql`DROP TYPE mirror_etl_run_status`.execute(db);
  await db.schema.dropTable('etl_watermark').execute();
}
