import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // pgvector — the schema's first extension (SPEC §5.8). `IF NOT EXISTS` so that on DO Managed
  // Postgres, where the migrate role may lack CREATE-EXTENSION privilege and an admin pre-installs
  // `vector`, this is a no-op instead of an error. Requires a pgvector-bearing image
  // (pgvector/pgvector:pg18); stock postgres:*-alpine does not ship the extension.
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);

  // ── proposal_embedding ── one 1536-dim vector per proposal per embedding_version (SPEC §5.8).
  // `text-embedding-3-small` output; `input_hash` lets the worker (#446) cache-hit an unchanged
  // composed input; re-embedding upserts on the unique key.
  await db.schema
    .createTable('proposal_embedding')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('proposal_id', 'uuid', (col) =>
      col.notNull().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('embedding_version', 'text', (col) => col.notNull())
    .addColumn('input_hash', 'text', (col) => col.notNull())
    .addColumn('embedding', sql`vector(1536)`, (col) => col.notNull())
    .addColumn('generated_at', 'timestamptz', (col) => col.notNull())
    .addColumn('cost_usd', sql`numeric(12, 6)`, (col) => col.notNull())
    .addUniqueConstraint('proposal_embedding_proposal_version_uq', [
      'proposal_id',
      'embedding_version',
    ])
    .execute();

  // ivfflat cosine index. Built on an initially-empty table — valid DDL (zero trained lists); recall
  // is poor until the historical backfill (M5-7) lands, after which a REINDEX with a `lists` tuned to
  // the corpus size is warranted. `lists = 100` is a conventional starting value.
  await sql`
    CREATE INDEX proposal_embedding_embedding_ivfflat
      ON proposal_embedding
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('proposal_embedding').execute();
  // Leave the `vector` extension: it is a shared, potentially load-bearing object, and dropping it in
  // a down-migration is riskier than leaving it installed.
}
