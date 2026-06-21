import type { Kysely } from 'kysely';
import { vi } from 'vitest';
import {
  up as up001,
  down as down001,
} from '../migrations-postgres/snapshot_001_proposal_metadata';

describe('snapshot migrations smoke (mocked db)', () => {
  function makeMockDb() {
    const executeQuery = vi.fn().mockResolvedValue({ rows: [] });
    const makeColumnBuilder = () => ({
      primaryKey: vi.fn().mockReturnThis(),
      defaultTo: vi.fn().mockReturnThis(),
      notNull: vi.fn().mockReturnThis(),
      unique: vi.fn().mockReturnThis(),
      check: vi.fn().mockReturnThis(),
      references: vi.fn().mockReturnThis(),
      onDelete: vi.fn().mockReturnThis(),
    });
    const makeTableBuilder = () => ({
      addColumn: vi
        .fn()
        .mockImplementation((_: unknown, __: unknown, callback?: (column: unknown) => unknown) => {
          callback?.(makeColumnBuilder());
          return makeTableBuilder();
        }),
      addUniqueConstraint: vi.fn().mockReturnThis(),
      addPrimaryKeyConstraint: vi.fn().mockReturnThis(),
      addCheckConstraint: vi.fn().mockReturnThis(),
      execute: executeQuery,
    });
    const executor = {
      executeQuery,
      transformQuery: vi.fn().mockImplementation((node: unknown) => node),
      compileQuery: vi
        .fn()
        .mockReturnValue({ sql: 'SELECT 1', parameters: [], queryId: { queryId: '1' } }),
    };
    return {
      getExecutor: vi.fn().mockReturnValue(executor),
      schema: {
        createTable: vi.fn().mockImplementation(() => makeTableBuilder()),
        dropTable: vi.fn().mockImplementation(() => ({ execute: executeQuery })),
      },
      _executeQuery: executeQuery,
    } as unknown as Kysely<unknown> & { _executeQuery: ReturnType<typeof vi.fn> };
  }

  it('snapshot_001_proposal_metadata up fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await up001(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('snapshot_001_proposal_metadata down fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await down001(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });
});
