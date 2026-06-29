import type { Kysely } from 'kysely';
import { describe, it, expect, vi } from 'vitest';
import type { ClickHouseDatabase } from '@libs/db';
import type { ArchiveConsumeContext, OffChainArchiveItem } from '@sources/core';
import { makeSnapshotOffChainArchiveWriter } from './archive-writer';

describe('makeSnapshotOffChainArchiveWriter', () => {
  it('inserts exactly the five archive_event_snapshot columns', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ execute }));
    const insertInto = vi.fn(() => ({ values }));
    const chDb = { insertInto } as unknown as Kysely<ClickHouseDatabase>;

    const write = makeSnapshotOffChainArchiveWriter({ chDb });
    const ctx: ArchiveConsumeContext = {
      daoSourceId: 'src-1',
      sourceType: 'snapshot',
      chainId: 'off-chain',
      sourceLabel: 'snapshot',
    };
    const item: OffChainArchiveItem = {
      externalId: 'prop:0xabc',
      contentHash: 'hash-v1',
      ordinal: '100',
      version: 3,
      payload: { id: '0xabc', title: 'A' },
    };

    await write(ctx, item);

    expect(insertInto).toHaveBeenCalledWith('archive_event_snapshot');
    expect(values).toHaveBeenCalledWith({
      dao_source_id: 'src-1',
      external_id: 'prop:0xabc',
      version: 3,
      content_hash: 'hash-v1',
      payload: JSON.stringify({ id: '0xabc', title: 'A' }),
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});
