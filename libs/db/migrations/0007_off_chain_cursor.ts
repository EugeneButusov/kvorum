import type { Kysely } from 'kysely';

// Off-chain poll cursor watermark (ADR-071 §off-chain consumer, Z2). One row per
// dao_source; the partition-aware TCursor blob is persisted each tick so a restart
// resumes instead of re-fetching from genesis. Kept in its own migration (not folded
// into 0002) — it is a distinct operational object, not a shape refinement of
// archive_event.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('off_chain_cursor')
    .addColumn('dao_source_id', 'uuid', (col) =>
      col.primaryKey().references('dao_source.id').onDelete('cascade'),
    )
    // Nullable: a source may return nextCursor=null (reset pagination); SQL NULL then
    // reads back as "no cursor → start fresh", same as an absent row.
    .addColumn('cursor', 'jsonb')
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('off_chain_cursor').execute();
}
