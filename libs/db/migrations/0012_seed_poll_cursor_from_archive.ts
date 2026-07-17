import { sql, type Kysely } from 'kysely';

// One-time bootstrap of `dao_source.poll_cursor_block` (added by 0011) for sources that were
// backfilled before the column existed.
//
// 0011 shipped the column with a lazy fallback in `DaoSourceRepository.readPollCursor`: when the
// cursor was null, infer a position from `max(archive_event.block_number)`. That works, but only
// because the poller writes the real cursor on its first accepted batch, after which the fallback
// never runs again — it is a bootstrap masquerading as a rule. As a rule it is wrong: the archive
// records what happened, not what was looked at. A range containing no events leaves no row, so a
// source whose contract has gone quiet would stay pinned to its last event, re-reading the same
// blocks every tick and never advancing. Only the first-tick write hid that.
//
// So do the bootstrap once, here, and let readPollCursor become a plain column read where null
// means "never scanned" rather than "go infer".
//
// The seed value is the same lower bound the fallback used: a backfill cannot archive an event from
// a block it never read, so the true scan depth is at or above `max(block_number)`. Erring low costs
// a re-read that `seen_log` dedupes; erring high would skip unread blocks and silently lose events.
// Direction is the entire safety argument, and nothing recorded the exact depth —
// `backfill_head_block` is a run's resume checkpoint and `clearBackfillState` nulls it on success.
//
// Runs as a migration rather than a runbook step precisely because nothing infers a position at
// runtime any more: a source left null resumes at chain head, which is the silent gap the column
// exists to prevent. A missed manual step would cause exactly that, in whichever environment it was
// missed. Sources with no archived events stay null — never scanned, so the poller starts from its
// confirmed-head window, and reaching back through history remains a backfill's job.
//
// Separate from 0011 because 0011 is already applied in production; an applied migration never
// re-runs.

/** Exported for test: `up` is not re-runnable against a database that has already applied it. */
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
  await seedPollCursorsFromArchive(db);
}

// Irreversible by intent: down() cannot distinguish a seeded watermark from one the poller has since
// advanced, and clearing a live cursor would resume its source at chain head — the gap this seed
// exists to close. 0011's down() drops the column outright, which is the real undo.
export async function down(): Promise<void> {
  // no-op
}
