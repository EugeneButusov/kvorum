import { describe, it, expect, vi } from 'vitest';
import { DaoSourceRepository } from './dao-source-repository';

function makeSelectChain(returnValue: unknown) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    execute,
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('DaoSourceRepository', () => {
  describe('findBySourceType', () => {
    it('#1 — returns rows matching the source type', async () => {
      const rows = [
        { id: 'src-1', dao_id: 'dao-1', source_config: {}, primary_chain_id: 1 },
        { id: 'src-2', dao_id: 'dao-2', source_config: {}, primary_chain_id: 137 },
      ];
      const { selectFrom } = makeSelectChain(rows);
      const repo = new DaoSourceRepository({ selectFrom } as never);

      const result = await repo.findBySourceType('compound_governor');
      expect(result).toEqual(rows);
    });

    it('#2 — returns empty array when no rows match', async () => {
      const { selectFrom } = makeSelectChain([]);
      const repo = new DaoSourceRepository({ selectFrom } as never);

      expect(await repo.findBySourceType('compound_governor')).toEqual([]);
    });

    it('#3 — queries dao_source with dao inner join', async () => {
      const { selectFrom, chain } = makeSelectChain([]);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      await repo.findBySourceType('compound_governor');

      expect(selectFrom).toHaveBeenCalledWith('dao_source');
      expect(chain.innerJoin).toHaveBeenCalledWith('dao', 'dao.id', 'dao_source.dao_id');
    });

    it('#4 — selects the expected columns', async () => {
      const { selectFrom, chain } = makeSelectChain([]);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      await repo.findBySourceType('compound_governor');

      expect(chain.select).toHaveBeenCalledWith([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_config',
        'dao.primary_chain_id',
      ]);
    });

    it('#5 — filters by the provided source_type', async () => {
      const { selectFrom, chain } = makeSelectChain([]);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      await repo.findBySourceType('uniswap_governor');

      expect(chain.where).toHaveBeenCalledWith('dao_source.source_type', '=', 'uniswap_governor');
    });
  });

  describe('findAll', () => {
    it('#1 — returns all rows', async () => {
      const rows = [
        {
          id: 'src-1',
          dao_id: 'dao-1',
          source_type: 'compound_governor',
          source_config: {},
          primary_chain_id: 1,
        },
        {
          id: 'src-2',
          dao_id: 'dao-2',
          source_type: 'aave_governor',
          source_config: {},
          primary_chain_id: 1,
        },
      ];
      const { selectFrom } = makeSelectChain(rows);
      const repo = new DaoSourceRepository({ selectFrom } as never);

      expect(await repo.findAll()).toEqual(rows);
    });

    it('#2 — returns empty array when no rows exist', async () => {
      const { selectFrom } = makeSelectChain([]);
      const repo = new DaoSourceRepository({ selectFrom } as never);

      expect(await repo.findAll()).toEqual([]);
    });

    it('#3 — queries dao_source with dao inner join', async () => {
      const { selectFrom, chain } = makeSelectChain([]);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      await repo.findAll();

      expect(selectFrom).toHaveBeenCalledWith('dao_source');
      expect(chain.innerJoin).toHaveBeenCalledWith('dao', 'dao.id', 'dao_source.dao_id');
    });

    it('#4 — selects expected columns including source_type', async () => {
      const { selectFrom, chain } = makeSelectChain([]);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      await repo.findAll();

      expect(chain.select).toHaveBeenCalledWith([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_type',
        'dao_source.source_config',
        'dao.primary_chain_id',
      ]);
    });

    it('#5 — orders by dao_source.id ascending', async () => {
      const { selectFrom, chain } = makeSelectChain([]);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      await repo.findAll();

      expect(chain.orderBy).toHaveBeenCalledWith('dao_source.id', 'asc');
    });

    it('#6 — applies no source_type filter', async () => {
      const { selectFrom, chain } = makeSelectChain([]);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      await repo.findAll();

      expect(chain.where).not.toHaveBeenCalled();
    });
  });

  // ---- Backfill checkpoint methods ----

  function makeSelectTakeFirst(returnValue: unknown) {
    const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
    const chain = {
      innerJoin: vi.fn(),
      select: vi.fn(),
      where: vi.fn(),
      executeTakeFirst,
    };
    chain.innerJoin.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    return { selectFrom: vi.fn().mockReturnValue(chain), chain };
  }

  function makeUpdateChain() {
    const execute = vi.fn().mockResolvedValue(undefined);
    const chain = {
      set: vi.fn(),
      where: vi.fn(),
      execute,
    };
    chain.set.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    return { updateTable: vi.fn().mockReturnValue(chain), chain };
  }

  describe('findByIdWithChain', () => {
    it('#1 — returns the row when found', async () => {
      const row = {
        id: 'src-1',
        dao_id: 'dao-1',
        source_type: 'compound_governor',
        source_config: {},
        active_from_block: null,
        backfill_started_at_block: '19000000',
        backfill_head_block: '19500000',
        primary_chain_id: '0x1',
      };
      const { selectFrom } = makeSelectTakeFirst(row);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      expect(await repo.findByIdWithChain('src-1')).toEqual(row);
    });

    it('#2 — returns undefined when not found', async () => {
      const { selectFrom } = makeSelectTakeFirst(undefined);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      expect(await repo.findByIdWithChain('missing')).toBeUndefined();
    });

    it('#3 — selects backfill checkpoint columns', async () => {
      const { selectFrom, chain } = makeSelectTakeFirst(undefined);
      const repo = new DaoSourceRepository({ selectFrom } as never);
      await repo.findByIdWithChain('src-1');
      expect(chain.select).toHaveBeenCalledWith(
        expect.arrayContaining([
          'dao_source.backfill_started_at_block',
          'dao_source.backfill_head_block',
          'dao_source.active_from_block',
        ]),
      );
    });
  });

  describe('captureBackfillStart', () => {
    it('#1 — sets backfill_started_at_block where it is null (idempotency guard)', async () => {
      const { updateTable, chain } = makeUpdateChain();
      const repo = new DaoSourceRepository({ updateTable } as never);
      await repo.captureBackfillStart('src-1', 20_000_000n);

      expect(updateTable).toHaveBeenCalledWith('dao_source');
      expect(chain.set).toHaveBeenCalledWith({ backfill_started_at_block: '20000000' });
      expect(chain.where).toHaveBeenCalledWith('dao_source.id', '=', 'src-1');
      expect(chain.where).toHaveBeenCalledWith('dao_source.backfill_started_at_block', 'is', null);
    });
  });

  describe('updateBackfillHead', () => {
    it('#1 — sets backfill_head_block for the given id', async () => {
      const { updateTable, chain } = makeUpdateChain();
      const repo = new DaoSourceRepository({ updateTable } as never);
      await repo.updateBackfillHead('src-1', 19_500_000n);

      expect(chain.set).toHaveBeenCalledWith({ backfill_head_block: '19500000' });
      expect(chain.where).toHaveBeenCalledWith('dao_source.id', '=', 'src-1');
    });
  });

  describe('clearBackfillState', () => {
    it('#1 — nulls both checkpoint columns', async () => {
      const { updateTable, chain } = makeUpdateChain();
      const repo = new DaoSourceRepository({ updateTable } as never);
      await repo.clearBackfillState('src-1');

      expect(chain.set).toHaveBeenCalledWith({
        backfill_started_at_block: null,
        backfill_head_block: null,
      });
      expect(chain.where).toHaveBeenCalledWith('dao_source.id', '=', 'src-1');
    });
  });
});
