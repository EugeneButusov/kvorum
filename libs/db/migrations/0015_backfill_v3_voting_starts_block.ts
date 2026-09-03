import { type Kysely, sql } from 'kysely';

/**
 * Re-derive VotingActivated events for aave_governance_v3 proposals so the updated projection
 * applier fills `voting_starts_block` (previously always NULL for V3). Resetting `derived_at`
 * makes the row eligible for the derivation pipeline, which replays it through the applier; the
 * applier's `fillVotingStartsBlock` uses COALESCE semantics (no-op if already set), so re-running
 * is safe. All other fields (timestamps, state) use the same COALESCE pattern, making re-derivation
 * fully idempotent.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE archive_event
    SET derived_at = NULL
    WHERE source_type = 'aave_governance_v3'
      AND event_type = 'VotingActivated'
      AND derived_at IS NOT NULL
  `.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // The re-derivation is idempotent — no rollback needed. The pipeline will re-derive these
  // rows on the next cycle regardless.
}
