import { afterAll, describe, expect, it, vi } from 'vitest';
import { chDb } from '@libs/db';
import type { ArchiveConsumeContext } from '@sources/core';
// @sources/snapshot schema augmentation — activates ClickHouseDatabase['archive_event_snapshot']
import '../src/persistence/schema';
import type { SnapshotClient } from '../src/client/client';
import { makeSnapshotOffChainArchiveWriter } from '../src/ingestion/archive-writer';
import { makeSnapshotPollListener } from '../src/ingestion/poll-listener';

const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = CH_URL ? describe : describe.skip;

const DAO_SOURCE_ID = 'a0000000-0000-4000-8000-000000000001';

// ReplacingMergeTree(version) parts may be unmerged at read time, and the kysely builder can't
// place FINAL after the table — so read all rows for the key and pick the greatest version in JS,
// mirroring what SELECT … FINAL collapses to.
async function selectFinal(
  externalId: string,
): Promise<Array<{ version: number; content_hash: string; payload: string }>> {
  const rows = await chDb
    .selectFrom('archive_event_snapshot')
    .select(['version', 'content_hash', 'payload'])
    .where('dao_source_id', '=', DAO_SOURCE_ID)
    .where('external_id', '=', externalId)
    .execute();
  if (rows.length === 0) return [];
  return [rows.reduce((a, b) => (b.version > a.version ? b : a))];
}

afterAll(async () => {
  await chDb.destroy();
});

describeIf('archive_event_snapshot CH round-trip', () => {
  it('RMT(version) deduplicates by version: SELECT FINAL returns the v2 row', async () => {
    const externalId = `rt-test-${Date.now()}`;

    await chDb
      .insertInto('archive_event_snapshot')
      .values({
        dao_source_id: DAO_SOURCE_ID,
        external_id: externalId,
        version: 1,
        content_hash: 'hash-v1',
        payload: JSON.stringify({ value: 'v1' }),
      })
      .execute();

    await chDb
      .insertInto('archive_event_snapshot')
      .values({
        dao_source_id: DAO_SOURCE_ID,
        external_id: externalId,
        version: 2,
        content_hash: 'hash-v2',
        payload: JSON.stringify({ value: 'v2' }),
      })
      .execute();

    const rows = await selectFinal(externalId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(2);
    expect(rows[0]!.content_hash).toBe('hash-v2');
    expect(JSON.parse(rows[0]!.payload)).toEqual({ value: 'v2' });
  });

  it('the AD1 off-chain writer persists raw slices; FINAL keeps the latest version', async () => {
    const write = makeSnapshotOffChainArchiveWriter({ chDb });
    const externalId = `prop:writer-${Date.now()}`;
    const ctx: ArchiveConsumeContext = {
      daoSourceId: DAO_SOURCE_ID,
      sourceType: 'snapshot',
      chainId: 'off-chain',
      sourceLabel: 'snapshot',
    };

    await write(ctx, {
      externalId,
      contentHash: 'h1',
      ordinal: '10',
      version: 1,
      payload: { state: 'active' },
    });
    await write(ctx, {
      externalId,
      contentHash: 'h2',
      ordinal: '20',
      version: 2,
      payload: { state: 'closed' },
    });

    const rows = await selectFinal(externalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(2);
    expect(JSON.parse(rows[0]!.payload)).toEqual({ state: 'closed' });
  });

  it('poll → writer round-trip lands namespaced proposal and vote rows in the archive', async () => {
    const stamp = Date.now();
    const client = {
      fetchProposals: vi.fn().mockResolvedValue([{ id: `p-${stamp}`, created: 100, title: 'A' }]),
      fetchVotes: vi.fn().mockResolvedValue([{ id: `v-${stamp}`, created: 101, choice: 1 }]),
    } as unknown as SnapshotClient;
    const listener = makeSnapshotPollListener(
      { client, space: 'lido-snapshot.eth', pageSize: 2 },
      60_000,
    );
    const write = makeSnapshotOffChainArchiveWriter({ chDb });
    const ctx: ArchiveConsumeContext = {
      daoSourceId: DAO_SOURCE_ID,
      sourceType: 'snapshot',
      chainId: 'off-chain',
      sourceLabel: 'snapshot',
    };

    const { items } = await listener.poll(
      { source: ctx, signal: new AbortController().signal },
      null,
    );
    // The generic consumer assigns version; here every item is a first insert (version 1).
    for (const item of items) {
      await write(ctx, {
        externalId: item.externalId,
        contentHash: item.contentHash,
        ordinal: item.ordinal,
        version: 1,
        payload: item.payload,
      });
    }

    const prop = await selectFinal(`prop:p-${stamp}`);
    const vote = await selectFinal(`vote:v-${stamp}`);
    expect(prop).toHaveLength(1);
    expect(vote).toHaveLength(1);
    expect(JSON.parse(prop[0]!.payload)).toMatchObject({ id: `p-${stamp}`, title: 'A' });
    expect(JSON.parse(vote[0]!.payload)).toMatchObject({ id: `v-${stamp}`, choice: 1 });
  });
});
