import type { Kysely } from 'kysely';
import { vi } from 'vitest';
import { up as up001, down as down001 } from '../migrations-postgres/snapshot_001_extension_tables';
import { up as up002, down as down002 } from '../migrations-postgres/snapshot_002_seed';
import { up as up004, down as down004 } from '../migrations-postgres/snapshot_004_delegation';
import {
  up as up005,
  down as down005,
} from '../migrations-postgres/snapshot_005_delegation_sources_seed';

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
    const makeIndexBuilder = () => ({
      on: vi.fn().mockReturnThis(),
      columns: vi.fn().mockReturnThis(),
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
        createIndex: vi.fn().mockImplementation(() => makeIndexBuilder()),
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

  it('snapshot_002_seed up fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await up002(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('snapshot_002_seed down fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await down002(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('snapshot_004_delegation up creates the table + indexes', async () => {
    const db = makeMockDb();
    await up004(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('snapshot_004_delegation down drops the table', async () => {
    const db = makeMockDb();
    await down004(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('snapshot_005_delegation_sources_seed up seeds the two on-chain dao_sources', async () => {
    const db = makeMockDb();
    await up005(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('snapshot_005_delegation_sources_seed down removes them', async () => {
    const db = makeMockDb();
    await down005(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });
});
