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

  it('guard R15: findCurrentDelegationForActor uses executeTakeFirst so latest delegation is returned', async () => {
    // Safe: the delegation_flow_projection VIEW provides one row per sorting key. The ORDER BY
    // + executeTakeFirst picks the latest block. A refactor switching to execute() would return
    // an array and break the caller expecting a single row.
    const pgDaoChain = makeChain({ id: 'dao-1', slug: 'dao' });
    const pgActorChain = makeChain({ primary_address: '0xabc' });
    const baseRow = {
      id: 'del-1',
      dao_id: 'dao-1',
      voting_power: '100',
      block_number: '99',
      tx_hash: '',
      event_type: 'delegate_changed',
      created_at: new Date(),
      delegator_address: '0xabc',
      delegate_address: '0xdef',
    };
    const chChain = makeChain(baseRow);

    const hydrateChain = {
      select: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      execute: vi.fn().mockResolvedValue([]),
    };
    hydrateChain.select.mockReturnValue(hydrateChain);
    hydrateChain.innerJoin.mockReturnValue(hydrateChain);
    hydrateChain.where.mockReturnValue(hydrateChain);

    const pg = {
      selectFrom: vi.fn().mockImplementation((table: string) => {
        if (table === 'dao') return pgDaoChain;
        if (table === 'actor') return pgActorChain;
        if (table === 'actor_address as aa') return hydrateChain;
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new DelegationReadRepository(pg as never, ch as never);

    await repo.findCurrentDelegationForActor('dao-1', 'actor-1');

    expect(chChain.executeTakeFirst).toHaveBeenCalledOnce();
    expect(chChain.orderBy).toHaveBeenCalledWith('d.block_number', 'desc');
    expect(chChain.orderBy).toHaveBeenCalledWith('d.delegation_id', 'desc');
  });

  it('guard R16: currentConfirmedHead uses max aggregate — safe against VIEW fan-out', async () => {
    // Safe: max(block_number) over all VIEW rows = the correct maximum regardless of how
    // many rows the GROUP BY produces. A refactor switching to a raw row fetch would be
    // non-deterministic if multiple partitions are scanned.
    const chChain = makeChain({ max_block_number: '500' });
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new DelegationReadRepository({ selectFrom: vi.fn() } as never, ch as never);

    await expect(repo.currentConfirmedHead('dao-1')).resolves.toBe('500');
    expect(chChain.executeTakeFirst).toHaveBeenCalledOnce();
  });
});
