import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { ClickHouseDatabase, OffchainArchiveRow } from '@libs/db';
import { ForumArchivePayloadRepository } from './archive-payload-repository';

function row(externalId: string): OffchainArchiveRow {
  return {
    id: externalId,
    source_type: 'discourse_forum',
    dao_source_id: 'd',
    chain_id: 'off-chain',
    external_id: externalId,
    derivation_ordinal: '1',
    event_type: 'DiscourseTopicCrawled',
    received_at: new Date(),
    derivation_attempt_count: 0,
  };
}

function fakeChDb(found: { external_id: string; version: number; payload: string }[]) {
  const chDb = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({ execute: () => Promise.resolve(found) }),
      }),
    }),
  };
  return chDb as unknown as Kysely<ClickHouseDatabase>;
}

describe('ForumArchivePayloadRepository.fetchLatest', () => {
  it('returns the greatest-version payload per external_id', async () => {
    const chDb = fakeChDb([
      { external_id: 'topic:1', version: 1, payload: 'a' },
      { external_id: 'topic:1', version: 3, payload: 'c' },
      { external_id: 'topic:2', version: 2, payload: 'b' },
    ]);
    const out = await new ForumArchivePayloadRepository(chDb).fetchLatest([
      row('topic:1'),
      row('topic:2'),
    ]);
    expect(out).toEqual([
      { external_id: 'topic:1', payload: 'c' },
      { external_id: 'topic:2', payload: 'b' },
    ]);
  });

  it('short-circuits an empty row set', async () => {
    const chDb = fakeChDb([]);
    await expect(new ForumArchivePayloadRepository(chDb).fetchLatest([])).resolves.toEqual([]);
  });
});
