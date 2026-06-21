import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { chDb } from '@libs/db';
// @sources/snapshot schema augmentation — activates ClickHouseDatabase['archive_event_snapshot']
import '../src/persistence/schema';

const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = CH_URL ? describe : describe.skip;

afterAll(async () => {
  await chDb.destroy();
});

describeIf('archive_event_snapshot CH round-trip', () => {
  it('RMT(version) deduplicates by version: SELECT FINAL returns the v2 row', async () => {
    const daoSourceId = 'a0000000-0000-4000-8000-000000000001';
    const externalId = `rt-test-${Date.now()}`;

    await chDb
      .insertInto('archive_event_snapshot')
      .values({
        dao_source_id: daoSourceId,
        external_id: externalId,
        version: 1,
        content_hash: 'hash-v1',
        payload: JSON.stringify({ value: 'v1' }),
      })
      .execute();

    await chDb
      .insertInto('archive_event_snapshot')
      .values({
        dao_source_id: daoSourceId,
        external_id: externalId,
        version: 2,
        content_hash: 'hash-v2',
        payload: JSON.stringify({ value: 'v2' }),
      })
      .execute();

    const rows = await chDb
      .selectFrom('archive_event_snapshot')
      .selectAll()
      .where('dao_source_id', '=', daoSourceId)
      .where('external_id', '=', externalId)
      // SELECT ... FINAL returns the winning row per RMT dedup key.
      .modifyEnd(sql`FINAL`)
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(2);
    expect(rows[0]!.content_hash).toBe('hash-v2');
    expect(JSON.parse(rows[0]!.payload)).toEqual({ value: 'v2' });
  });
});
