import { sql, type Kysely } from 'kysely';

// Derivation back-off marker (resolves KNOWN-028).
//
// Aave's cross-chain appliers intentionally *hold* a row whose mainnet counterpart has not derived
// yet (ADR-065 `no_proposal`, and the payloads-controller `no_declared_payload` stitch). Until now a
// hold left the row completely untouched: still `derived_at IS NULL`, attempt count unchanged. The
// derivation worker selects the oldest N derivable rows in (chain_id, block_number, log_index)
// order, so held rows sit at the head and get re-picked every tick forever.
//
// Live that is only a delay — the counterpart lands minutes later. During a *backfill* it is a
// deadlock: the counterpart is at a HIGHER block than the held rows, so it can never be reached
// while they occupy the head. Once a contiguous run of held rows exceeds the batch size, derivation
// stops entirely and silently (no error, no DLQ row, attempt count pinned at 0).
//
// `derivation_hold_until` makes a hold an explicit, queryable deferral: the applier stamps a
// re-check time, the worker skips the row until then, and everything behind it keeps flowing.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('archive_event')
    .addColumn('derivation_hold_until', 'timestamptz')
    .execute();

  // Partial: only un-derived rows are ever consulted by the derivable queries, and only a small
  // fraction of those are ever held.
  await sql`
    CREATE INDEX idx_archive_event_derivation_hold_until
    ON archive_event (derivation_hold_until)
    WHERE derived_at IS NULL AND derivation_hold_until IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_archive_event_derivation_hold_until`.execute(db);
  await db.schema.alterTable('archive_event').dropColumn('derivation_hold_until').execute();
}
