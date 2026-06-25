import { describe, expect, it, vi } from 'vitest';
import { AragonEnactmentLookup } from './aragon-enactment-lookup';

function selectChain(terminal: { execute?: unknown; executeTakeFirst?: unknown }) {
  const chain: Record<string, unknown> = {
    // `select` may receive a callback (the max() aggregate) — invoke it so the aggregate builder runs.
    select: vi.fn((arg: unknown) => {
      if (typeof arg === 'function') {
        (arg as (eb: unknown) => unknown)({ fn: { max: () => ({ as: () => undefined }) } });
      }
      return chain;
    }),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    execute: vi.fn().mockResolvedValue(terminal.execute),
    executeTakeFirst: vi.fn().mockResolvedValue(terminal.executeTakeFirst),
  };
  return chain;
}

describe('AragonEnactmentLookup.findEnactmentVoteId', () => {
  it('returns the voteId of the co-tx ExecuteVote (last received_at wins)', async () => {
    const rows = [
      { payload: JSON.stringify({ voteId: '200' }), received_at: new Date(1) },
      { payload: JSON.stringify({ voteId: '201' }), received_at: new Date(2) },
    ];
    const db = { selectFrom: () => selectChain({ execute: rows }) } as never;
    await expect(new AragonEnactmentLookup(db).findEnactmentVoteId('0x1', '0xtx')).resolves.toBe(
      '201',
    );
  });

  it('returns undefined when no ExecuteVote shares the tx (a direct submission)', async () => {
    const db = { selectFrom: () => selectChain({ execute: [] }) } as never;
    await expect(
      new AragonEnactmentLookup(db).findEnactmentVoteId('0x1', '0xtx'),
    ).resolves.toBeUndefined();
  });
});

describe('AragonEnactmentLookup.maxArchivedBlock', () => {
  it('returns the highest archived block as a bigint', async () => {
    const db = {
      selectFrom: () => selectChain({ executeTakeFirst: { max_block: '23095715' } }),
    } as never;
    await expect(new AragonEnactmentLookup(db).maxArchivedBlock('0x1')).resolves.toBe(23095715n);
  });

  it('returns undefined when the archive is empty', async () => {
    const db = {
      selectFrom: () => selectChain({ executeTakeFirst: { max_block: null } }),
    } as never;
    await expect(new AragonEnactmentLookup(db).maxArchivedBlock('0x1')).resolves.toBeUndefined();
  });

  it('returns undefined when no row is returned', async () => {
    const db = { selectFrom: () => selectChain({ executeTakeFirst: undefined }) } as never;
    await expect(new AragonEnactmentLookup(db).maxArchivedBlock('0x1')).resolves.toBeUndefined();
  });
});
