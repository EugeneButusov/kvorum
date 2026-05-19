import { describe, expect, it, vi } from 'vitest';
import { withDaoSourceAdvisoryLock } from './dao-source-lock';

vi.mock('kysely', async () => {
  const actual = await vi.importActual<object>('kysely');
  return {
    ...actual,
    sql: vi.fn(),
  };
});

describe('withDaoSourceAdvisoryLock', () => {
  it('#1 - returns contended when lock is not acquired', async () => {
    const { sql } = await import('kysely');
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ locked: false }] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(sql).mockReturnValue({ execute: exec } as never);

    const out = await withDaoSourceAdvisoryLock({
      db: {} as never,
      daoSourceId: 'src-1',
      run: vi.fn(),
    });

    expect(out).toEqual({ status: 'contended' });
  });
});
