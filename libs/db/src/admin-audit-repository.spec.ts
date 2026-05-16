import { describe, it, expect, vi } from 'vitest';
import { AdminAuditRepository } from './admin-audit-repository';

function makeUpdateChain(returnValue?: unknown) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    execute,
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { updateTable: vi.fn().mockReturnValue(chain), chain };
}

function makeSelectChain(returnValue: unknown) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    selectAll: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    execute,
  };
  chain.selectAll.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('AdminAuditRepository', () => {
  describe('start', () => {
    it('#1 — inserts a row and returns the id', async () => {
      const executeTakeFirstOrThrow = vi.fn().mockResolvedValue({ id: 'audit-uuid-1' });
      const returning = vi.fn().mockReturnValue({ executeTakeFirstOrThrow });
      const values = vi.fn().mockReturnValue({ returning });
      const insertInto = vi.fn().mockReturnValue({ values });

      const repo = new AdminAuditRepository({ insertInto } as never);
      const id = await repo.start({
        command: 'keys create',
        args: { userId: 'u1' },
        executor: 'root',
        executorKind: 'sudo',
      });

      expect(id).toBe('audit-uuid-1');
      expect(insertInto).toHaveBeenCalledWith('admin_audit');
    });

    it('#2 — passes command, executor, executor_kind, and args to values()', async () => {
      const executeTakeFirstOrThrow = vi.fn().mockResolvedValue({ id: 'x' });
      const returning = vi.fn().mockReturnValue({ executeTakeFirstOrThrow });
      const values = vi.fn().mockReturnValue({ returning });
      const insertInto = vi.fn().mockReturnValue({ values });

      const repo = new AdminAuditRepository({ insertInto } as never);
      await repo.start({
        command: 'dao add',
        args: { slug: 'uniswap' },
        executor: 'alice',
        executorKind: 'env',
      });

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'dao add',
          args: { slug: 'uniswap' },
          executor: 'alice',
          executor_kind: 'env',
        }),
      );
    });

    it('#3 — calls returning("id")', async () => {
      const executeTakeFirstOrThrow = vi.fn().mockResolvedValue({ id: 'x' });
      const returning = vi.fn().mockReturnValue({ executeTakeFirstOrThrow });
      const values = vi.fn().mockReturnValue({ returning });
      const insertInto = vi.fn().mockReturnValue({ values });

      const repo = new AdminAuditRepository({ insertInto } as never);
      await repo.start({ command: 'x', args: {}, executor: 'u', executorKind: 'unknown' });

      expect(returning).toHaveBeenCalledWith('id');
    });
  });

  describe('complete', () => {
    it('#1 — sets outcome=success and error=null on success', async () => {
      const { updateTable, chain } = makeUpdateChain();
      const repo = new AdminAuditRepository({ updateTable } as never);
      await repo.complete({ id: 'audit-1', outcome: 'success' });

      expect(updateTable).toHaveBeenCalledWith('admin_audit');
      expect(chain.set).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'success', error: null }),
      );
      expect(chain.where).toHaveBeenCalledWith('id', '=', 'audit-1');
    });

    it('#2 — sets outcome=failure and includes error object on failure', async () => {
      const { updateTable, chain } = makeUpdateChain();
      const repo = new AdminAuditRepository({ updateTable } as never);
      await repo.complete({
        id: 'audit-2',
        outcome: 'failure',
        error: { name: 'Error', message: 'boom' },
      });

      expect(chain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'failure',
          error: { name: 'Error', message: 'boom' },
        }),
      );
    });
  });

  describe('listRecent', () => {
    it('#1 — queries admin_audit ordered by started_at desc with limit', async () => {
      const rows = [
        { id: 'a1', command: 'keys create', outcome: 'success', started_at: new Date() },
      ];
      const { selectFrom, chain } = makeSelectChain(rows);
      const repo = new AdminAuditRepository({ selectFrom } as never);

      const result = await repo.listRecent(50);

      expect(result).toEqual(rows);
      expect(selectFrom).toHaveBeenCalledWith('admin_audit');
      expect(chain.selectAll).toHaveBeenCalledOnce();
      expect(chain.orderBy).toHaveBeenCalledWith('started_at', 'desc');
      expect(chain.limit).toHaveBeenCalledWith(50);
    });

    it('#2 — returns empty array when no rows', async () => {
      const { selectFrom } = makeSelectChain([]);
      const repo = new AdminAuditRepository({ selectFrom } as never);
      expect(await repo.listRecent(10)).toEqual([]);
    });

    it('#3 — returns rows with null outcome (in-progress or orphan)', async () => {
      const rows = [{ id: 'a1', command: 'backfill start', outcome: null, completed_at: null }];
      const { selectFrom } = makeSelectChain(rows);
      const repo = new AdminAuditRepository({ selectFrom } as never);
      const result = await repo.listRecent(10);
      expect(result[0]).toMatchObject({ outcome: null, completed_at: null });
    });
  });
});
