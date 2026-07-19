import { describe, expect, it, vi } from 'vitest';
import { ActorRoutingReadRepository } from './actor-routing-repository';

function makeSelectChain(returnValue: unknown, listValue: unknown[] = []) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const execute = vi.fn().mockResolvedValue(listValue);
  const chain = {
    selectAll: vi.fn(),
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    whereRef: vi.fn(),
    orderBy: vi.fn(),
    executeTakeFirst,
    execute,
  };
  chain.selectAll.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.whereRef.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('ActorRoutingReadRepository', () => {
  it('findLiveActorByPrimaryAddress lowercases and filters to live actors', async () => {
    const row = { id: 'a1', primary_address: '0x1' };
    const { selectFrom, chain } = makeSelectChain(row);
    const repo = new ActorRoutingReadRepository({ selectFrom } as never);

    await expect(repo.findLiveActorByPrimaryAddress('0xABCDEF')).resolves.toEqual(row);
    expect(selectFrom).toHaveBeenCalledWith('actor');
    expect(chain.where).toHaveBeenCalledWith('primary_address', '=', '0xabcdef');
    expect(chain.where).toHaveBeenCalledWith('merged_into_actor_id', 'is', null);
  });

  it('findRedirect joins actor to get survivor primary address', async () => {
    const row = {
      to_actor_id: 'actor-1',
      survivor_primary_address: '0xabc',
    };
    const { selectFrom, chain } = makeSelectChain(row);
    const repo = new ActorRoutingReadRepository({ selectFrom } as never);

    await expect(repo.findRedirect('0xABC')).resolves.toEqual(row);
    expect(selectFrom).toHaveBeenCalledWith('actor_address_redirect as aar');
    expect(chain.innerJoin).toHaveBeenCalledWith('actor as a', 'a.id', 'aar.to_actor_id');
    expect(chain.select).toHaveBeenCalledWith([
      'aar.to_actor_id as to_actor_id',
      'a.primary_address as survivor_primary_address',
    ]);
    expect(chain.where).toHaveBeenCalledWith('aar.from_address', '=', '0xabc');
  });

  it('findLiveActorByAnyAddress lowercases lookup and returns actor + primary address', async () => {
    const row = {
      actor_id: 'actor-1',
      primary_address: '0xabc',
    };
    const { selectFrom, chain } = makeSelectChain(row);
    const repo = new ActorRoutingReadRepository({ selectFrom } as never);

    await expect(repo.findLiveActorByAnyAddress('0xABC')).resolves.toEqual(row);
    expect(selectFrom).toHaveBeenCalledWith('actor as a');
    expect(chain.innerJoin).toHaveBeenCalledWith('actor_address as aa', 'aa.actor_id', 'a.id');
    expect(chain.select).toHaveBeenCalledWith(['a.id as actor_id', 'a.primary_address']);
    expect(chain.where).toHaveBeenCalledWith('aa.address', '=', '0xabc');
  });

  it('findMergeMap pairs each non-canonical address with its actor primary address', async () => {
    const { selectFrom, chain } = makeSelectChain(undefined, [
      { address: '0xabsorbed', canonical_address: '0xsurvivor' },
    ]);
    const repo = new ActorRoutingReadRepository({ selectFrom } as never);

    await expect(repo.findMergeMap()).resolves.toEqual([
      { address: '0xabsorbed', canonicalAddress: '0xsurvivor' },
    ]);
    expect(selectFrom).toHaveBeenCalledWith('actor_address as aa');
    expect(chain.innerJoin).toHaveBeenCalledWith('actor as a', 'a.id', 'aa.actor_id');
    // whereRef, not where: this compares two columns, so a value predicate would be wrong.
    expect(chain.whereRef).toHaveBeenCalledWith('aa.address', '<>', 'a.primary_address');
    // The map is embedded in ClickHouse query text, so its order must be deterministic.
    expect(chain.orderBy).toHaveBeenCalledWith('aa.address', 'asc');
  });
});
