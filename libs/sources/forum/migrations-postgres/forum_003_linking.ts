import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Proposal↔forum linking support.
//
// - `forum_thread.title`: the Discourse topic title. Needed for community-curated (title-based)
//   linking and for API display; the crawl previously stored only raw_content.
// - `proposal_forum_link_scan`: the linker sweep's watermark, kept as a forum-owned extension table
//   (not a column on core `proposal`) so no forum concern leaks into libs/db. A proposal with a row
//   here has been evaluated; the row is deleted to re-queue a proposal when a new thread lands.
// - `low` on proposal_forum_link_confidence: wires the M5 low/inferred path (KNOWN-005) so no enum
//   migration is needed then; the linker only writes high/medium.

export async function up(db: Kysely<unknown>): Promise<void> {
  // Enum ADD VALUE is idempotent + valid inside PG's migration transaction (PG 12+); the value is
  // only wired here, not written by the deterministic linker.
  await sql`ALTER TYPE proposal_forum_link_confidence ADD VALUE IF NOT EXISTS 'low'`.execute(db);

  await sql`ALTER TABLE forum_thread ADD COLUMN title text`.execute(db);

  await db.schema
    .createTable('proposal_forum_link_scan')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.primaryKey().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('scanned_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('proposal_forum_link_scan').execute();
  await sql`ALTER TABLE forum_thread DROP COLUMN IF EXISTS title`.execute(db);
  // PostgreSQL cannot DROP an enum value, so 'low' remains on proposal_forum_link_confidence.
}
