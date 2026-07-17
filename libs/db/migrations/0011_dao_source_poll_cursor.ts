import { type Kysely } from 'kysely';

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
// Distinct from the neighbouring `backfill_started_at_block` / `backfill_head_block` by lifecycle:
// those bound a single backfill run, whereas this is continuously written by the live path and is
// never reset by a completed operation. (Those two are also, as of this migration, written by
// nothing — `captureBackfillStart`/`updateBackfillHead` have no callers.)
//
// Deliberately not backfilled here. `DaoSourceRepository.readPollCursor` falls back to
// `max(archive_event.block_number)` for the source when this is null, which covers both the existing
// sources (whose archives already hold a backfilled watermark) and every future backfill-then-poll
// handoff. A one-shot seed would only fix the former.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('dao_source')
    // Last block whose logs every listener accepted. bigint: chain heights outrun int4, and the pg
    // driver hands these back as strings to preserve precision (see libs/db/src/client.ts).
    // Nullable: a source that has never polled has no position, and null selects the fallback.
    .addColumn('poll_cursor_block', 'bigint')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('dao_source').dropColumn('poll_cursor_block').execute();
}
