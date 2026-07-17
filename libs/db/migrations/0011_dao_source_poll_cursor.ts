import { sql, type Kysely } from 'kysely';

// Per-source EVM poll watermark — closes the live poller's cold-start gap.
//
// `EventPoller` polled a sliding window anchored at confirmed head: `[head - 2*headLag, head]`,
// about five minutes of blocks on mainnet. It held no position, so any downtime longer than that
// window left the intervening blocks permanently unread — the poller resumed at the tip and never
// looked back. A routine deploy restarts the indexer, so the hazard was not exceptional; the
// previous contract simply declared the gap a backfill's problem and relied on an operator
// remembering to run one.
//
// The poller now reads this on its first tick, polls forward from it in bounded chunks until it
// reaches confirmed head, and advances it only once every listener has accepted the batch — so a
// listener failure re-reads the same range rather than skipping it.
//
// Distinct from the neighbouring `backfill_started_at_block` / `backfill_head_block` by lifecycle,
// which is why it cannot reuse them. Those two are a single run's resume checkpoint: BackfillDriver
// writes them per chunk and `clearBackfillState` nulls them the moment the run completes — so by
// the time a poller wants to know where scanning reached, they are gone by design. This column is
// permanent: the highest block scanned for the source by any path, advanced by both the backfill
// (BackfillDriver.onChunkComplete) and the live poller, never cleared.
//
// Sources backfilled before this migration have no watermark, and nothing recorded how far their
// runs scanned. The seed below bootstraps them from `max(archive_event.block_number)` — the last
// block that produced an *event* for the source.
//
// That is a lower bound on what was scanned, not the truth: a backfill cannot archive an event from
// a block it never read, so the real scan depth is at or above it. Erring low is the safe direction
// — the poller re-reads blocks it has already seen (finding nothing, and `seen_log` drops any
// duplicate) and walks forward to head. Erring high would skip unread blocks and silently lose
// events, which is the whole failure this column exists to prevent. For a governor that has gone
// quiet the re-read spans millions of empty blocks; that costs minutes of catch-up, once.
//
// It runs here rather than as a lazy fallback in the repository because it is a one-time bootstrap,
// not a rule: every backfill from here on records the exact watermark as it goes
// (BackfillDriver.onChunkComplete), and the poller maintains it thereafter. Keeping it in the
// migration also means it cannot be forgotten in an environment — and forgetting it would leave a
// source resuming at head, i.e. the silent gap.
//
// A source with no archived events stays null: it has never been scanned, so it starts from the
// poller's confirmed-head window. Reaching back through history is a backfill's job.
/** Exported for test: `up` also adds the column, which cannot re-run against a migrated database. */
export async function seedPollCursorsFromArchive(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE dao_source ds
    SET poll_cursor_block = seed.max_block
    FROM (
      SELECT dao_source_id, max(block_number) AS max_block
      FROM archive_event
      WHERE block_number IS NOT NULL
      GROUP BY dao_source_id
    ) AS seed
    WHERE ds.id = seed.dao_source_id
      AND ds.poll_cursor_block IS NULL
  `.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('dao_source')
    // Last block whose logs every listener accepted. bigint: chain heights outrun int4, and the pg
    // driver hands these back as strings to preserve precision (see libs/db/src/client.ts).
    // Nullable: a source that has never been scanned has no position.
    .addColumn('poll_cursor_block', 'bigint')
    .execute();

  await seedPollCursorsFromArchive(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('dao_source').dropColumn('poll_cursor_block').execute();
}
