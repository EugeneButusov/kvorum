import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Supports the M5-1.4 AI trigger scan: `WHERE state IN (...) AND state_updated_at >= cutoff`.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE INDEX idx_proposal_state_updated_at ON proposal (state, state_updated_at DESC)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX idx_proposal_state_updated_at`.execute(db);
}
