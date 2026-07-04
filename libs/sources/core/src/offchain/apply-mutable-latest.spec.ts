import { describe, expect, it, vi } from 'vitest';
import type { ArchiveConsumeContext } from '../index';
import { applyOffChainMutableLatest, type OffChainArchiveStore } from './apply-mutable-latest';

const ctx: ArchiveConsumeContext = {
  daoSourceId: 'src-1',
  sourceType: 'snapshot',
  chainId: 'off-chain',
  sourceLabel: 'snapshot',
};

const item = {
  externalId: '0xabc',
  contentHash: 'hash-v1',
  ordinal: '100',
  eventType: 'snapshot_proposal_created' as never,
  payload: { foo: 'bar' },
};

function makeStore(existing: { content_hash: string | null; version: number | null } | undefined): {
  store: OffChainArchiveStore;
  insert: ReturnType<typeof vi.fn>;
  reArchive: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn().mockResolvedValue(undefined);
  const reArchive = vi.fn().mockResolvedValue(true);
  const store = {
    findByExternalId: vi.fn().mockResolvedValue(existing ? { id: 'e1', ...existing } : undefined),
    insert,
    reArchiveOffchain: reArchive,
  } as unknown as OffChainArchiveStore;
  return { store, insert, reArchive };
}

describe('applyOffChainMutableLatest', () => {
  it('inserts a new row at version 1 when none exists', async () => {
    const { store, insert, reArchive } = makeStore(undefined);
    const write = vi.fn().mockResolvedValue(undefined);

    const outcome = await applyOffChainMutableLatest(ctx, item, { archiveEventRepo: store, write });

    expect(outcome).toBe('inserted');
    expect(write).toHaveBeenCalledWith(ctx, expect.objectContaining({ version: 1 }));
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: '0xabc', content_hash: 'hash-v1', version: 1 }),
    );
    expect(reArchive).not.toHaveBeenCalled();
  });

  it('skips (no write) when the content hash is unchanged', async () => {
    const { store, insert, reArchive } = makeStore({ content_hash: 'hash-v1', version: 3 });
    const write = vi.fn().mockResolvedValue(undefined);

    const outcome = await applyOffChainMutableLatest(ctx, item, { archiveEventRepo: store, write });

    expect(outcome).toBe('skip_unchanged');
    expect(write).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(reArchive).not.toHaveBeenCalled();
  });

  it('re-archives at version+1 with a CAS update when the content changed', async () => {
    const { store, insert, reArchive } = makeStore({ content_hash: 'hash-v0', version: 3 });
    const write = vi.fn().mockResolvedValue(undefined);

    const outcome = await applyOffChainMutableLatest(ctx, item, { archiveEventRepo: store, write });

    expect(outcome).toBe('re_archived');
    expect(write).toHaveBeenCalledWith(ctx, expect.objectContaining({ version: 4 }));
    expect(reArchive).toHaveBeenCalledWith(
      { sourceType: 'snapshot', chainId: 'off-chain', externalId: '0xabc' },
      { contentHash: 'hash-v1', version: 4, ordinal: '100' },
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('writes CH before the PG watermark (CH-first ordering)', async () => {
    const order: string[] = [];
    const { store } = makeStore(undefined);
    (store.insert as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('pg');
    });
    const write = vi.fn().mockImplementation(async () => {
      order.push('ch');
    });

    await applyOffChainMutableLatest(ctx, item, { archiveEventRepo: store, write });

    expect(order).toEqual(['ch', 'pg']);
  });
});
