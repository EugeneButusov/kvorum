import { sql, type Kysely } from 'kysely';

// Per-source EVM poll watermark — closes the live poller's cold-start gap.
//
// `EventPoller` polls a sliding window anchored at confirmed head: `[head - 2*headLag, head]`, about
// five minutes of blocks on mainnet. It holds no position, so any downtime longer than that window
// leaves the intervening blocks permanently unread — the poller resumes at the tip and never looks
// back. A routine deploy restarts the indexer, so the hazard is not exceptional; the previous
// contract simply declared the gap a backfill's problem and relied on an operator remembering.
//
// This table gives each EVM dao_source the resumable pointer the off-chain sources already have
// (`off_chain_cursor`, ADR-071). The poller reads it on its first tick, polls forward from it in
// bounded chunks until it reaches confirmed head, and advances it only once every listener has
// accepted the batch — so a listener failure re-reads the same range rather than skipping it.
//
// Deliberately not seeded here. `EvmPollCursorRepository.read` falls back to
// `max(archive_event.block_number)` for the source when no row exists, which covers both the
// existing sources (whose archives already hold a backfilled watermark) and every future
// backfill-then-poll handoff. A one-shot seed would only fix the former.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('evm_poll_cursor')
    .addColumn('dao_source_id', 'uuid', (col) =>
      col.primaryKey().references('dao_source.id').onDelete('cascade'),
    )
    // The last block whose logs are fully dispatched. bigint: chain heights outrun int4, and the pg
    // driver hands these back as strings to preserve precision (see libs/db/src/client.ts).
    .addColumn('last_polled_block', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('evm_poll_cursor').execute();
}
