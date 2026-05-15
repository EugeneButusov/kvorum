import { describe, expect, it, vi } from 'vitest';
import type { NewSelectorIndex, SelectorIndex } from './schema/pg';
import { SelectorIndexRepository } from './selector-index-repository';

const ROW: NewSelectorIndex = {
  selector: '0xa9059cbb',
  signature: 'transfer(address,uint256)',
  source: 'etherscan',
  imported_at: new Date('2026-01-01T00:00:00Z'),
};

function makeInsertChain(numInserted: bigint = 1n) {
  let capturedValues: unknown;
  let capturedColumns: readonly string[] | undefined;
  const executeTakeFirst = vi.fn().mockResolvedValue({ numInsertedOrUpdatedRows: numInserted });
  const doNothing = vi.fn().mockReturnValue({ executeTakeFirst });
  const onConflict = vi.fn().mockImplementation((fn: (oc: ConflictBuilder) => unknown) => {
    fn({
      columns: (cols) => {
        capturedColumns = cols;
        return { doNothing };
      },
    });
    return { executeTakeFirst };
  });
  const values = vi.fn().mockImplementation((v: unknown) => {
    capturedValues = v;
    return { onConflict };
  });
  const insertInto = vi.fn().mockReturnValue({ values });
  return {
    insertInto,
    get capturedValues() {
      return capturedValues;
    },
    get capturedColumns() {
      return capturedColumns;
    },
  };
}

interface ConflictBuilder {
  columns(cols: readonly string[]): { doNothing(): unknown };
}

function makeSelectChain(returnValue: SelectorIndex[]) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const chain = { selectAll: vi.fn(), where: vi.fn(), execute };
  chain.selectAll.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  const selectFrom = vi.fn().mockReturnValue(chain);
  return { selectFrom, ...chain };
}

describe('SelectorIndexRepository', () => {
  describe('bulkInsert', () => {
    it('returns 0 without querying when given an empty array', async () => {
      const insert = makeInsertChain();
      const repo = new SelectorIndexRepository({ insertInto: insert.insertInto } as never);
      expect(await repo.bulkInsert([])).toBe(0);
      expect(insert.insertInto).not.toHaveBeenCalled();
    });

    it('inserts into selector_index and returns count of inserted rows', async () => {
      const insert = makeInsertChain(1n);
      const repo = new SelectorIndexRepository({ insertInto: insert.insertInto } as never);

      const count = await repo.bulkInsert([ROW]);

      expect(count).toBe(1);
      expect(insert.insertInto).toHaveBeenCalledWith('selector_index');
      expect(insert.capturedValues).toEqual([ROW]);
    });

    it('uses ON CONFLICT (selector, signature) DO NOTHING', async () => {
      const insert = makeInsertChain(0n);
      const repo = new SelectorIndexRepository({ insertInto: insert.insertInto } as never);

      await repo.bulkInsert([ROW]);

      expect(insert.capturedColumns).toEqual(['selector', 'signature']);
    });

    it('returns 0 when all rows conflict', async () => {
      const insert = makeInsertChain(0n);
      const repo = new SelectorIndexRepository({ insertInto: insert.insertInto } as never);
      expect(await repo.bulkInsert([ROW])).toBe(0);
    });

    it('handles multiple rows including collision candidates', async () => {
      const collision: NewSelectorIndex = {
        selector: '0xa9059cbb',
        signature: 'tgeSetGoal(uint256)',
        source: 'etherscan',
        imported_at: new Date('2026-01-01T00:00:00Z'),
      };
      const insert = makeInsertChain(2n);
      const repo = new SelectorIndexRepository({ insertInto: insert.insertInto } as never);

      const count = await repo.bulkInsert([ROW, collision]);

      expect(count).toBe(2);
      expect(insert.capturedValues).toEqual([ROW, collision]);
    });
  });

  describe('lookupBySelector', () => {
    it('returns all rows matching the selector', async () => {
      const rows: SelectorIndex[] = [
        { ...ROW, imported_at: new Date() },
        {
          selector: '0xa9059cbb',
          signature: 'tgeSetGoal(uint256)',
          source: 'etherscan',
          imported_at: new Date(),
        },
      ];
      const select = makeSelectChain(rows);
      const repo = new SelectorIndexRepository({ selectFrom: select.selectFrom } as never);

      const result = await repo.lookupBySelector('0xa9059cbb');

      expect(result).toEqual(rows);
      expect(select.selectFrom).toHaveBeenCalledWith('selector_index');
      expect(select.where).toHaveBeenCalledWith('selector', '=', '0xa9059cbb');
    });

    it('returns empty array when selector is unknown', async () => {
      const select = makeSelectChain([]);
      const repo = new SelectorIndexRepository({ selectFrom: select.selectFrom } as never);
      expect(await repo.lookupBySelector('0xdeadbeef')).toEqual([]);
    });
  });
});
