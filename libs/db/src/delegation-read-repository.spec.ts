import { describe, expect, it, vi } from 'vitest';
import { DelegationReadRepository } from './delegation-read-repository';

function makeChain<T>(result: T) {
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    execute: vi.fn().mockResolvedValue(result),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

describe('DelegationReadRepository', () => {
  it('listForDao returns empty when dao is missing', async () => {
    const pgDaoChain = makeChain(undefined);
    const pg = { selectFrom: vi.fn().mockReturnValue(pgDaoChain) };
    const ch = { selectFrom: vi.fn() };
    const repo = new DelegationReadRepository(pg as never, ch as never);

    await expect(repo.listForDao({ daoId: 'dao-1' })).resolves.toEqual([]);
    expect(ch.selectFrom).not.toHaveBeenCalled();
  });

  it('findCurrentDelegationForActor returns undefined when actor has no primary address', async () => {
    const pgDaoChain = makeChain({ id: 'dao-1', slug: 'dao' });
    const pgActorChain = makeChain(undefined);
    const pg = {
      selectFrom: vi.fn().mockImplementation((table: string) => {
        if (table === 'dao') return pgDaoChain;
        if (table === 'actor') return pgActorChain;
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const ch = { selectFrom: vi.fn() };
    const repo = new DelegationReadRepository(pg as never, ch as never);

    await expect(repo.findCurrentDelegationForActor('dao-1', 'actor-1')).resolves.toBeUndefined();
    expect(ch.selectFrom).not.toHaveBeenCalled();
  });

  it('currentConfirmedHead reads max block from clickhouse', async () => {
    const chChain = makeChain({ max_block_number: '123' });
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new DelegationReadRepository({ selectFrom: vi.fn() } as never, ch as never);

    await expect(repo.currentConfirmedHead('dao-1')).resolves.toBe('123');
    expect(ch.selectFrom).toHaveBeenCalled();
    expect(chChain.where).toHaveBeenCalledWith('d.dao_id', '=', 'dao-1');
  });
});
