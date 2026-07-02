import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Proposal↔forum linking support.
//
// - `forum_thread.title`: the Discourse topic title. Needed for community-curated (title-based)
//   linking and for API display; the crawl previously stored only raw_content.
// - `proposal.forum_link_scanned_at`: watermark for the proposal-driven linker sweep. A partial
//   index over the NULL rows keeps the sweep's "not yet scanned" scan cheap — scanned rows leave
//   the index.
// - `low` on proposal_forum_link_confidence: wires the M5 low/inferred path (KNOWN-005) so no enum
//   migration is needed then; the linker only writes high/medium.

export async function up(db: Kysely<unknown>): Promise<void> {
  // Enum ADD VALUE is idempotent + valid inside PG's migration transaction (PG 12+); the value is
  // only wired here, not written by the deterministic linker.
  await sql`ALTER TYPE proposal_forum_link_confidence ADD VALUE IF NOT EXISTS 'low'`.execute(db);

  await sql`ALTER TABLE forum_thread ADD COLUMN title text`.execute(db);

  await sql`ALTER TABLE proposal ADD COLUMN forum_link_scanned_at timestamptz`.execute(db);

  await sql`
    CREATE INDEX proposal_forum_link_unscanned_idx
    ON proposal (dao_id)
    WHERE forum_link_scanned_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS proposal_forum_link_unscanned_idx`.execute(db);
  await sql`ALTER TABLE proposal DROP COLUMN IF EXISTS forum_link_scanned_at`.execute(db);
  await sql`ALTER TABLE forum_thread DROP COLUMN IF EXISTS title`.execute(db);
  // PostgreSQL cannot DROP an enum value, so 'low' remains on proposal_forum_link_confidence.
}
