import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { ClickHouseDatabase } from '@libs/db';
import type { ArchiveConsumeContext, OffChainArchiveItem } from '@sources/core';
import { makeForumOffChainArchiveWriter } from './archive-writer';

function fakeChDb() {
  const captured: { table?: string; values?: Record<string, unknown>; executed?: boolean } = {};
  const chDb = {
    insertInto: (table: string) => ({
      values: (values: Record<string, unknown>) => {
        captured.table = table;
        captured.values = values;
        return {
          execute: () => {
            captured.executed = true;
            return Promise.resolve();
          },
        };
      },
    }),
  };
  return { chDb: chDb as unknown as Kysely<ClickHouseDatabase>, captured };
}

const ctx: ArchiveConsumeContext = {
  daoSourceId: 'dao-source-1',
  sourceType: 'discourse_forum',
  chainId: 'off-chain',
  sourceLabel: 'discourse_forum',
};

describe('makeForumOffChainArchiveWriter', () => {
  it('inserts the five archive columns into archive_event_discourse_forum with the payload stringified', async () => {
    const { chDb, captured } = fakeChDb();
    const item: OffChainArchiveItem = {
      externalId: 'topic:42',
      contentHash: 'abc',
      ordinal: '42',
      version: 3,
      payload: { host: 'research.lido.fi', topicId: 42 },
    };

    await makeForumOffChainArchiveWriter({ chDb })(ctx, item);

    expect(captured.table).toBe('archive_event_discourse_forum');
    expect(captured.values).toEqual({
      dao_source_id: 'dao-source-1',
      external_id: 'topic:42',
      version: 3,
      content_hash: 'abc',
      payload: JSON.stringify({ host: 'research.lido.fi', topicId: 42 }),
    });
    expect(captured.executed).toBe(true);
  });
});
