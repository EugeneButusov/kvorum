import type { Kysely } from 'kysely';
import { vi } from 'vitest';
import { up as up001, down as down001 } from '../migrations-postgres/lido_001_aragon_voting';
import { up as up002, down as down002 } from '../migrations-postgres/lido_002_dual_governance';
import { up as up003, down as down003 } from '../migrations-postgres/lido_003_easy_track';
import { up as up004, down as down004 } from '../migrations-postgres/lido_004_seed';
import { up as up005, down as down005 } from '../migrations-postgres/lido_005_dual_governance_seed';
import {
  up as up006,
  down as down006,
} from '../migrations-postgres/lido_006_dual_governance_proposal';

describe('lido migrations smoke (mocked db)', () => {
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
      column: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      unique: vi.fn().mockReturnThis(),
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
        createIndex: vi.fn().mockImplementation(() => makeIndexBuilder()),
        dropTable: vi.fn().mockImplementation(() => ({ execute: executeQuery })),
        dropIndex: vi.fn().mockImplementation(() => ({ execute: executeQuery })),
      },
      _executeQuery: executeQuery,
    } as unknown as Kysely<unknown> & { _executeQuery: ReturnType<typeof vi.fn> };
  }

  it('lido_001_aragon_voting up fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await up001(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_001_aragon_voting down fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await down001(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_002_dual_governance up fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await up002(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_002_dual_governance down fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await down002(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_003_easy_track up fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await up003(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_003_easy_track down fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await down003(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_004_seed up fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await up004(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_004_seed down fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await down004(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_005_dual_governance_seed up fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await up005(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_005_dual_governance_seed down fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await down005(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_006_dual_governance_proposal up fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await up006(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('lido_006_dual_governance_proposal down fires at least one sql.execute', async () => {
    const db = makeMockDb();
    await down006(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });
});
