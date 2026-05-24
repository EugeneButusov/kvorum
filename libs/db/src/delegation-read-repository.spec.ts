import { describe, expect, it, vi } from 'vitest';
import { DelegationReadRepository } from './delegation-read-repository';

function makeSelectChain(returnValue: unknown) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    execute,
    executeTakeFirst,
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('DelegationReadRepository', () => {
  it('listBaseQuery uses left join for delegate actor', async () => {
    const { selectFrom, chain } = makeSelectChain([]);
    const repo = new DelegationReadRepository({ selectFrom } as never);

    await repo.listBaseQuery().execute();

    expect(selectFrom).toHaveBeenCalledWith('delegation');
    expect(chain.leftJoin).toHaveBeenCalledWith(
      'actor as delegate',
      'delegate.id',
      'delegation.delegate_actor_id',
    );
  });

  it('findCurrentDelegationForActor applies current delegation ordering', async () => {
    const row = { id: 'd1' };
    const { selectFrom, chain } = makeSelectChain(row);
    const repo = new DelegationReadRepository({ selectFrom } as never);

    await repo.findCurrentDelegationForActor('dao-1', 'actor-1');

    expect(chain.where).toHaveBeenCalledWith('delegation.dao_id', '=', 'dao-1');
    expect(chain.where).toHaveBeenCalledWith('delegation.delegator_actor_id', '=', 'actor-1');
    expect(chain.where).toHaveBeenCalledWith('delegation.event_type', '=', 'delegate_changed');
    expect(chain.orderBy).toHaveBeenCalledWith('delegation.block_number', 'desc');
  });

  it('currentConfirmedHead returns max delegation block', async () => {
    const { selectFrom, chain } = makeSelectChain({ max_block_number: '123' });
    const repo = new DelegationReadRepository({ selectFrom } as never);

    await expect(repo.currentConfirmedHead('dao-1')).resolves.toBe('123');
    expect(selectFrom).toHaveBeenCalledWith('delegation');
    expect(chain.where).toHaveBeenCalledWith('dao_id', '=', 'dao-1');
  });
});
