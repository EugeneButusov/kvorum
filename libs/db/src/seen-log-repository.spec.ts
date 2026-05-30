import { describe, it, expect, vi } from 'vitest';
import type { NewSeenLog } from './schema/seen-log';
import { SeenLogRepository } from './seen-log-repository';

const COORD: NewSeenLog = {
  chain_id: '0x1',
  tx_hash: '0xtx',
  log_index: 3,
  block_number: '100',
  block_hash: '0xblock',
};

// Builder for the insertInto('seen_log').values().onConflict().returning().executeTakeFirst() chain
function makeInsertChain(result: { tx_hash: string } | undefined) {
  const executeTakeFirst = vi.fn().mockResolvedValue(result);
  const returning = vi.fn().mockReturnValue({ executeTakeFirst });
  const doNothing = vi.fn().mockReturnValue({ returning });
  const columns = vi.fn().mockReturnValue({ doNothing });
  const onConflict = vi.fn().mockReturnValue({ columns });
  const values = vi.fn().mockReturnValue({ onConflict });
  const insertInto = vi.fn().mockReturnValue({ values });

  // The oc callback is called with the mock onConflict builder; thread it through
  onConflict.mockImplementation((cb: (oc: { columns: typeof columns }) => unknown) => {
    cb({ columns });
    return { returning };
  });

  return { insertInto, values, onConflict, returning, executeTakeFirst };
}

// Builder for the deleteFrom().where().where().executeTakeFirst() chain
function makeDeleteChain(numDeletedRows: bigint) {
  const executeTakeFirst = vi.fn().mockResolvedValue({ numDeletedRows });
  const where2 = vi.fn().mockReturnValue({ executeTakeFirst });
  const where1 = vi.fn().mockReturnValue({ where: where2, executeTakeFirst });
  const deleteFrom = vi.fn().mockReturnValue({ where: where1 });
  return { deleteFrom, where1, where2, executeTakeFirst };
}

describe('SeenLogRepository', () => {
  describe('recordIfNew()', () => {
    it('returns true when the coordinate is new (INSERT succeeds)', async () => {
      const chain = makeInsertChain({ tx_hash: '0xtx' });
      const repo = new SeenLogRepository({} as never);
      const trx = { insertInto: chain.insertInto } as never;

      const result = await repo.recordIfNew(trx, COORD);

      expect(result).toBe(true);
      expect(chain.insertInto).toHaveBeenCalledWith('seen_log');
      expect(chain.values).toHaveBeenCalledWith(COORD);
    });

    it('returns false when the coordinate already exists (ON CONFLICT DO NOTHING)', async () => {
      const chain = makeInsertChain(undefined); // RETURNING fires no row
      const repo = new SeenLogRepository({} as never);

      const result = await repo.recordIfNew({ insertInto: chain.insertInto } as never, COORD);

      expect(result).toBe(false);
    });
  });

  describe('pruneBelow()', () => {
    it('deletes rows below the horizon block and returns the count', async () => {
      const chain = makeDeleteChain(7n);
      const repo = new SeenLogRepository({ deleteFrom: chain.deleteFrom } as never);

      const deleted = await repo.pruneBelow('0x1', 964n);

      expect(deleted).toBe(7);
      expect(chain.deleteFrom).toHaveBeenCalledWith('seen_log');
      expect(chain.where1).toHaveBeenCalledWith('chain_id', '=', '0x1');
      expect(chain.where2).toHaveBeenCalledWith('block_number', '<', '964');
    });

    it('returns 0 when no rows are deleted', async () => {
      const chain = makeDeleteChain(0n);
      const repo = new SeenLogRepository({ deleteFrom: chain.deleteFrom } as never);

      expect(await repo.pruneBelow('0x1', 964n)).toBe(0);
    });
  });
});
