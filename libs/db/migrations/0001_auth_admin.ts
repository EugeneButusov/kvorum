import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── Enum types ──────────────────────────────────────────────────────────────
  await sql`
    CREATE TYPE user_role AS ENUM ('user', 'admin')
  `.execute(db);

  await sql`
    CREATE TYPE api_key_tier AS ENUM ('authenticated_free', 'dashboard')
  `.execute(db);

  await sql`
    CREATE TYPE audit_outcome AS ENUM ('success', 'failure')
  `.execute(db);

  await sql`
    CREATE TYPE executor_kind AS ENUM ('ssh', 'sudo', 'env', 'unknown')
  `.execute(db);

  // ── users ───────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('display_name', 'text', (col) => col.notNull())
    .addColumn('role', sql`user_role`, (col) => col.notNull())
    .addColumn('banned_at', 'timestamptz')
    .addColumn('banned_reason', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull())
    .execute();

  // ── api_key ─────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('api_key')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    .addColumn('key_hash', 'bytea', (col) => col.notNull().unique())
    .addColumn('prefix', 'text', (col) => col.notNull())
    .addColumn('last_four', 'text', (col) => col.notNull())
    .addColumn('tier', sql`api_key_tier`, (col) => col.notNull())
    .addColumn('label', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_api_key_user_id_revoked_at')
    .on('api_key')
    .columns(['user_id', 'revoked_at'])
    .execute();

  // ── admin_audit ─────────────────────────────────────────────────────────────
  await db.schema
    .createTable('admin_audit')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('command', 'text', (col) => col.notNull())
    .addColumn('args', 'jsonb', (col) => col.notNull())
    .addColumn('executor', 'text', (col) => col.notNull())
    .addColumn('executor_kind', sql`executor_kind`, (col) => col.notNull())
    .addColumn('started_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .addColumn('outcome', sql`audit_outcome`)
    .addColumn('error', 'jsonb')
    .execute();

  await db.schema
    .createIndex('idx_admin_audit_executor_started_at')
    .on('admin_audit')
    .columns(['executor', 'started_at desc'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('admin_audit').execute();
  await db.schema.dropTable('api_key').execute();
  await db.schema.dropTable('users').execute();

  await sql`DROP TYPE executor_kind`.execute(db);
  await sql`DROP TYPE audit_outcome`.execute(db);
  await sql`DROP TYPE api_key_tier`.execute(db);
  await sql`DROP TYPE user_role`.execute(db);
}
