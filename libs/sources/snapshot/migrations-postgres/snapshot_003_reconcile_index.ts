import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Supports the AD2 closed-proposal reconcile stale-query: per space, proposals whose tally isn't
// yet `final`. The partial index on (space_id, scores_state) WHERE scores_state IS NULL OR IN
// ('pending','active') keeps the candidate set tiny (most proposals are 'final' and excluded).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX snapshot_proposal_metadata_reconcile_idx
    ON snapshot_proposal_metadata (space_id, scores_state)
    WHERE scores_state IS NULL OR scores_state IN ('pending', 'active')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS snapshot_proposal_metadata_reconcile_idx`.execute(db);
}
