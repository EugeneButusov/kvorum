import type { Kysely } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pgDb } from './client';
import { down as downCoreDomain, up as upCoreDomain } from '../migrations/0002_core_domain';

class RollbackSignal extends Error {}

describe('db migrations smoke (mocked db)', () => {
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
      execute: executeQuery,
    });
    const makeIndexBuilder = () => ({
      on: vi.fn().mockReturnThis(),
      columns: vi.fn().mockReturnThis(),
      column: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
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
      },
      _executeQuery: executeQuery,
    } as unknown as Kysely<unknown> & { _executeQuery: ReturnType<typeof vi.fn> };
  }

  it('0002_core_domain up/down fire schema queries', async () => {
    const db = makeMockDb();
    await upCoreDomain(db);
    await downCoreDomain(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });
});

const describeWithPg = process.env['DATABASE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
});

describeWithPg('0002_core_domain proposal_action schema', () => {
  it('includes payload_index and the payload-scoped uniqueness constraint', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        const payloadIndexColumn = await tx
          .selectFrom('information_schema.columns')
          .select(['column_name', 'is_nullable', 'column_default'])
          .where('table_name', '=', 'proposal_action')
          .where('column_name', '=', 'payload_index')
          .executeTakeFirstOrThrow();
        expect(payloadIndexColumn.column_name).toBe('payload_index');
        expect(payloadIndexColumn.is_nullable).toBe('NO');
        expect(payloadIndexColumn.column_default).toContain('0');

        const payloadConstraint = await tx
          .selectFrom('pg_constraint')
          .select('conname')
          .where('conname', '=', 'proposal_action_proposal_id_payload_index_action_index_key')
          .execute();
        expect(payloadConstraint).toEqual([
          { conname: 'proposal_action_proposal_id_payload_index_action_index_key' },
        ]);

        const legacyConstraint = await tx
          .selectFrom('pg_constraint')
          .select('conname')
          .where('conname', '=', 'proposal_action_proposal_id_action_index_key')
          .execute();
        expect(legacyConstraint).toEqual([]);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
