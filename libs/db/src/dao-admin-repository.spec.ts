import { describe, it, expect, vi } from 'vitest';
import { DaoAdminRepository } from './dao-admin-repository';

function makeInsertReturningAllChain(returnValue: unknown) {
  const executeTakeFirstOrThrow = vi.fn().mockResolvedValue(returnValue);
  const returningAll = vi.fn().mockReturnValue({ executeTakeFirstOrThrow });
  const values = vi.fn().mockReturnValue({ returningAll });
  const insertInto = vi.fn().mockReturnValue({ values });
  return { insertInto, values, returningAll, executeTakeFirstOrThrow };
}

function makeSelectChain(returnValue: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirst,
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

function makeUpdateChain(returnValue: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    executeTakeFirst,
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { updateTable: vi.fn().mockReturnValue(chain), chain };
}

describe('DaoAdminRepository', () => {
  describe('createDao', () => {
    it('#1 — inserts into dao and returns the row', async () => {
      const expected = {
        id: 'dao-1',
        slug: 'uniswap',
        name: 'Uniswap',
        primary_token_address: '0x' + 'a'.repeat(40),
        primary_chain_id: '1',
        description: '',
        website_url: '',
        forum_url: '',
      };
      const { insertInto, executeTakeFirstOrThrow } = makeInsertReturningAllChain(expected);
      const repo = new DaoAdminRepository({ insertInto } as never);
      const result = await repo.createDao({
        slug: 'uniswap',
        name: 'Uniswap',
        primaryTokenAddress: '0x' + 'a'.repeat(40),
        primaryChainId: '1',
      });
      expect(result).toEqual(expected);
      expect(insertInto).toHaveBeenCalledWith('dao');
      expect(executeTakeFirstOrThrow).toHaveBeenCalledOnce();
    });

    it('#2 — passes slug, name, token address, chain id, and empty metadata fields', async () => {
      const { insertInto, values } = makeInsertReturningAllChain({ id: 'x' });
      const repo = new DaoAdminRepository({ insertInto } as never);
      await repo.createDao({
        slug: 'compound',
        name: 'Compound',
        primaryTokenAddress: '0xCOMP',
        primaryChainId: '0x1',
      });
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'compound',
          name: 'Compound',
          primary_token_address: '0xCOMP',
          primary_chain_id: '0x1',
          description: '',
          website_url: '',
          forum_url: '',
        }),
      );
    });
  });

  describe('findDaoBySlug', () => {
    it('#1 — returns id and slug when found', async () => {
      const { selectFrom } = makeSelectChain({ id: 'dao-1', slug: 'compound' });
      const repo = new DaoAdminRepository({ selectFrom } as never);
      const result = await repo.findDaoBySlug('compound');
      expect(result).toEqual({ id: 'dao-1', slug: 'compound' });
      expect(selectFrom).toHaveBeenCalledWith('dao');
    });

    it('#2 — returns undefined when not found', async () => {
      const { selectFrom } = makeSelectChain(undefined);
      const repo = new DaoAdminRepository({ selectFrom } as never);
      expect(await repo.findDaoBySlug('missing')).toBeUndefined();
    });

    it('#3 — filters by slug', async () => {
      const { selectFrom, chain } = makeSelectChain(undefined);
      const repo = new DaoAdminRepository({ selectFrom } as never);
      await repo.findDaoBySlug('uniswap');
      expect(chain.where).toHaveBeenCalledWith('slug', '=', 'uniswap');
    });
  });

  describe('addSource', () => {
    it('#1 — inserts into dao_source and returns the row', async () => {
      const expected = {
        id: 'src-1',
        dao_id: 'dao-1',
        source_type: 'compound_governor_bravo',
        source_config: { governor_address: '0x' + 'b'.repeat(40) },
      };
      const { insertInto } = makeInsertReturningAllChain(expected);
      const repo = new DaoAdminRepository({ insertInto } as never);
      const result = await repo.addSource({
        daoId: 'dao-1',
        sourceType: 'compound_governor_bravo',
        chainId: '0x1',
        sourceConfig: { governor_address: '0x' + 'b'.repeat(40) },
      });
      expect(result).toEqual(expected);
      expect(insertInto).toHaveBeenCalledWith('dao_source');
    });

    it('#2 — passes dao_id, source_type, and source_config to values()', async () => {
      const { insertInto, values } = makeInsertReturningAllChain({ id: 'x' });
      const repo = new DaoAdminRepository({ insertInto } as never);
      await repo.addSource({
        daoId: 'd1',
        sourceType: 'compound_governor_bravo',
        chainId: '0x89',
        sourceConfig: { a: 1 },
      });
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          dao_id: 'd1',
          source_type: 'compound_governor_bravo',
          chain_id: '0x89',
          source_config: { a: 1 },
        }),
      );
    });
  });

  describe('updateSourceConfig', () => {
    it('#1 — returns 1 when a row was updated', async () => {
      const { updateTable } = makeUpdateChain({ numUpdatedRows: 1n });
      const repo = new DaoAdminRepository({ updateTable } as never);
      const count = await repo.updateSourceConfig('src-1', {
        governor_address: '0x' + 'c'.repeat(40),
      });
      expect(count).toBe(1);
      expect(updateTable).toHaveBeenCalledWith('dao_source');
    });

    it('#2 — returns 0 when no row was matched (not found)', async () => {
      const { updateTable } = makeUpdateChain(undefined);
      const repo = new DaoAdminRepository({ updateTable } as never);
      expect(await repo.updateSourceConfig('missing', {})).toBe(0);
    });

    it('#3 — sets source_config and filters by id', async () => {
      const { updateTable, chain } = makeUpdateChain({ numUpdatedRows: 1n });
      const repo = new DaoAdminRepository({ updateTable } as never);
      const cfg = { governor_address: '0xABC' };
      await repo.updateSourceConfig('src-5', cfg);
      expect(chain.set).toHaveBeenCalledWith({ source_config: cfg });
      expect(chain.where).toHaveBeenCalledWith('id', '=', 'src-5');
    });
  });

  describe('setSourceLivePolling', () => {
    it('#1 — sets the flag, filters by id, returns rows updated', async () => {
      const { updateTable, chain } = makeUpdateChain({ numUpdatedRows: 1n });
      const repo = new DaoAdminRepository({ updateTable } as never);
      const count = await repo.setSourceLivePolling('src-1', false);
      expect(count).toBe(1);
      expect(updateTable).toHaveBeenCalledWith('dao_source');
      expect(chain.set).toHaveBeenCalledWith({ live_polling_enabled: false });
      expect(chain.where).toHaveBeenCalledWith('id', '=', 'src-1');
    });

    it('#2 — returns 0 when no row matched (not found)', async () => {
      const { updateTable } = makeUpdateChain(undefined);
      const repo = new DaoAdminRepository({ updateTable } as never);
      expect(await repo.setSourceLivePolling('missing', true)).toBe(0);
    });
  });

  describe('findSourceById', () => {
    it('#1 — returns the source row when found', async () => {
      const row = { id: 'src-1', source_type: 'compound_governor_bravo', source_config: {} };
      const { selectFrom } = makeSelectChain(row);
      const repo = new DaoAdminRepository({ selectFrom } as never);
      expect(await repo.findSourceById('src-1')).toEqual(row);
    });

    it('#2 — returns undefined when not found', async () => {
      const { selectFrom } = makeSelectChain(undefined);
      const repo = new DaoAdminRepository({ selectFrom } as never);
      expect(await repo.findSourceById('missing')).toBeUndefined();
    });

    it('#3 — selects id, source_type, source_config and filters by id', async () => {
      const { selectFrom, chain } = makeSelectChain(undefined);
      const repo = new DaoAdminRepository({ selectFrom } as never);
      await repo.findSourceById('src-9');
      expect(chain.select).toHaveBeenCalledWith(['id', 'source_type', 'source_config']);
      expect(chain.where).toHaveBeenCalledWith('id', '=', 'src-9');
    });
  });

  describe('sourceTypeExists', () => {
    it('#1 — returns true when a matching row exists', async () => {
      const { selectFrom } = makeSelectChain({ ok: 1 });
      const repo = new DaoAdminRepository({ selectFrom } as never);
      expect(await repo.sourceTypeExists('compound_governor_bravo')).toBe(true);
    });

    it('#2 — returns false when no matching row exists', async () => {
      const { selectFrom } = makeSelectChain(undefined);
      const repo = new DaoAdminRepository({ selectFrom } as never);
      expect(await repo.sourceTypeExists('unknown_type')).toBe(false);
    });
  });
});
