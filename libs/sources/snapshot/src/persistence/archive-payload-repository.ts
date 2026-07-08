import type { Kysely } from 'kysely';
import type { ClickHouseDatabase, OffchainArchiveRow } from '@libs/db';

export interface SnapshotArchivePayload {
  external_id: string;
  payload: string;
}

/** Reads the current (max-version) archived slice per external_id from the off-chain
 *  `archive_event_snapshot` ReplacingMergeTree. The builder can't place FINAL after the table, and
 *  parts may be unmerged at read time, so we fetch all versions for the keys and pick the greatest
 *  in JS — the same approach AD1's round-trip test uses. */
export class SnapshotArchivePayloadRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async fetchLatest(rows: readonly OffchainArchiveRow[]): Promise<SnapshotArchivePayload[]> {
    if (rows.length === 0) return [];
    const externalIds = [...new Set(rows.map((row) => row.external_id))];

    const found = await this.chDb
      .selectFrom('archive_event_snapshot')
      .select(['external_id', 'version', 'payload'])
      .where('external_id', 'in', externalIds)
      .execute();

    const latest = new Map<string, { version: number; payload: string }>();
    for (const row of found) {
      const current = latest.get(row.external_id);
      if (current === undefined || row.version > current.version) {
        latest.set(row.external_id, { version: row.version, payload: row.payload });
      }
    }
    return [...latest.entries()].map(([external_id, value]) => ({
      external_id,
      payload: value.payload,
    }));
  }

  /** Fetch the current (max-version) payload for a single external_id, or undefined if none is
   *  archived. Used by the vote deriver to inspect a vote's parent proposal (flagged/deleted) when
   *  no `proposal` row exists. */
  async fetchByExternalId(externalId: string): Promise<string | undefined> {
    const found = await this.chDb
      .selectFrom('archive_event_snapshot')
      .select(['version', 'payload'])
      .where('external_id', '=', externalId)
      .execute();

    let latest: { version: number; payload: string } | undefined;
    for (const row of found) {
      if (latest === undefined || row.version > latest.version) latest = row;
    }
    return latest?.payload;
  }
}
