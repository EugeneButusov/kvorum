import type { Kysely } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pgDb } from './client';
import { ProposalRepository } from './proposal-repository';
import type { PgDatabase } from './schema/pg';

// A chainable select mock: selectFrom → select → where → where → execute. `where`/`select`
// return the same chain so calls accumulate on one vi.fn (we assert the captured args).
function makeSelectManyChain(rows: unknown[]) {
  const execute = vi.fn().mockResolvedValue(rows);
  const chain: {
    where: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    execute: typeof execute;
  } = { where: vi.fn(), select: vi.fn(), execute };
  chain.where.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  const selectFrom = vi.fn().mockReturnValue(chain);
  return { selectFrom, select: chain.select, where: chain.where, execute };
}

describe('ProposalRepository.findRecentlyTransitioned (query shape)', () => {
  it('selects ids where state in the set and state_updated_at >= since, and returns the rows', async () => {
    const chain = makeSelectManyChain([{ id: 'p1' }, { id: 'p2' }]);
    const repo = new ProposalRepository({
      selectFrom: chain.selectFrom,
    } as unknown as Kysely<PgDatabase>);
    const since = new Date('2026-07-11T11:00:00Z');

    const result = await repo.findRecentlyTransitioned(['pending', 'active'], since);

    expect(result).toEqual([{ id: 'p1' }, { id: 'p2' }]);
    expect(chain.selectFrom).toHaveBeenCalledWith('proposal');
    expect(chain.select).toHaveBeenCalledWith('id');
    expect(chain.where).toHaveBeenCalledWith('state', 'in', ['pending', 'active']);
    expect(chain.where).toHaveBeenCalledWith('state_updated_at', '>=', since);
  });

  it('short-circuits to [] without querying when states is empty', async () => {
    const chain = makeSelectManyChain([]);
    const repo = new ProposalRepository({
      selectFrom: chain.selectFrom,
    } as unknown as Kysely<PgDatabase>);

    const result = await repo.findRecentlyTransitioned([], new Date());

    expect(result).toEqual([]);
    expect(chain.selectFrom).not.toHaveBeenCalled();
  });
});

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

describeWithDb('ProposalRepository.findRecentlyTransitioned (integration smoke)', () => {
  afterAll(async () => {
    await pgDb.destroy();
  });

  it('runs against real Postgres (exercising idx_proposal_state_updated_at) and returns an array', async () => {
    const repo = new ProposalRepository(pgDb);
    const rows = await repo.findRecentlyTransitioned(['pending', 'active'], new Date(0));
    expect(Array.isArray(rows)).toBe(true);
  });
});
