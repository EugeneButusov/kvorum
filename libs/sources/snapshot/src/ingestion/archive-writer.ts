import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { OffChainArchiveWriteFn } from '@sources/core';

export interface SnapshotOffChainArchiveWriterDeps {
  chDb: Kysely<ClickHouseDatabase>;
}

/** Per-source off-chain CH writer (ADR-071). The generic off-chain consumer owns the PG watermark
 *  and the mutable-latest decision (version bump on content_hash change); this writer only inserts
 *  the raw slice into the ReplacingMergeTree(version) archive. Exactly the five table columns —
 *  event_type/ordinal/received_at ride the PG archive_event row, not CH. */
export function makeSnapshotOffChainArchiveWriter(
  deps: SnapshotOffChainArchiveWriterDeps,
): OffChainArchiveWriteFn {
  return async (ctx, item) => {
    await deps.chDb
      .insertInto('archive_event_snapshot')
      .values({
        dao_source_id: ctx.daoSourceId,
        external_id: item.externalId,
        version: item.version,
        content_hash: item.contentHash,
        payload: JSON.stringify(item.payload),
      })
      .execute();
  };
}
