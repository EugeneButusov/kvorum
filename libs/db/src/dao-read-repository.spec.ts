import { describe, expect, it, vi } from 'vitest';
import { DaoReadRepository } from './dao-read-repository';

function makeSelectChain(returnValue: unknown) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    selectAll: vi.fn(),
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    execute,
    executeTakeFirst,
  };
  chain.selectAll.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('DaoReadRepository', () => {
  it('findDaoBySlug queries dao by slug', async () => {
    const row = { id: 'dao-1', slug: 'alpha' };
    const { selectFrom, chain } = makeSelectChain(row);
    const repo = new DaoReadRepository({ selectFrom } as never);

    await expect(repo.findDaoBySlug('alpha')).resolves.toEqual(row);
    expect(selectFrom).toHaveBeenCalledWith('dao');
    expect(chain.where).toHaveBeenCalledWith('slug', '=', 'alpha');
  });

  it('listSourcesForDao selects the expected columns', async () => {
    const rows = [{ source_type: 'compound_governor', source_config: {} }];
    const { selectFrom, chain } = makeSelectChain(rows);
    const repo = new DaoReadRepository({ selectFrom } as never);

    await expect(repo.listSourcesForDao('dao-1')).resolves.toEqual(rows);
    expect(selectFrom).toHaveBeenCalledWith('dao_source');
    expect(chain.select).toHaveBeenCalledWith(['source_type', 'source_config']);
    expect(chain.where).toHaveBeenCalledWith('dao_id', '=', 'dao-1');
  });

  it('findSourceByDaoSlugAndType joins dao to dao_source', async () => {
    const row = {
      id: 'src-1',
      dao_id: 'dao-1',
      source_type: 'compound_governor',
      source_config: {},
    };
    const { selectFrom, chain } = makeSelectChain(row);
    const repo = new DaoReadRepository({ selectFrom } as never);

    await expect(repo.findSourceByDaoSlugAndType('alpha', 'compound_governor')).resolves.toEqual(
      row,
    );
    expect(selectFrom).toHaveBeenCalledWith('dao_source');
    expect(chain.innerJoin).toHaveBeenCalledWith('dao', 'dao.id', 'dao_source.dao_id');
    expect(chain.select).toHaveBeenCalledWith([
      'dao_source.id',
      'dao_source.dao_id',
      'dao_source.source_type',
      'dao_source.source_config',
    ]);
    expect(chain.where).toHaveBeenCalledWith('dao.slug', '=', 'alpha');
    expect(chain.where).toHaveBeenCalledWith('dao_source.source_type', '=', 'compound_governor');
  });
});
