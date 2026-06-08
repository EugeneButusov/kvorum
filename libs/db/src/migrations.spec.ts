import type { Kysely } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pgDb } from './client';
import {
  down as downProposalActionPayloadIndex,
  up as upProposalActionPayloadIndex,
} from '../migrations/0010_proposal_action_payload_index';

class RollbackSignal extends Error {}

describe('db migrations smoke (mocked db)', () => {
  function makeMockDb() {
    const executeQuery = vi.fn().mockResolvedValue({ rows: [] });
    const makeColumnBuilder = () => ({
      notNull: vi.fn().mockReturnThis(),
      defaultTo: vi.fn().mockReturnThis(),
    });
    const makeSchemaAction = () => ({
      addColumn: vi
        .fn()
        .mockImplementation((_: unknown, __: unknown, callback?: (column: unknown) => unknown) => {
          callback?.(makeColumnBuilder());
          return makeSchemaAction();
        }),
      addUniqueConstraint: vi.fn().mockReturnThis(),
      dropColumn: vi.fn().mockReturnThis(),
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
        alterTable: vi.fn().mockImplementation(() => makeSchemaAction()),
      },
      _executeQuery: executeQuery,
    } as unknown as Kysely<unknown> & { _executeQuery: ReturnType<typeof vi.fn> };
  }

  it('0010_proposal_action_payload_index up/down fire schema queries', async () => {
    const db = makeMockDb();
    await upProposalActionPayloadIndex(db);
    await downProposalActionPayloadIndex(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });
});

const describeWithPg = process.env['DATABASE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
});

describeWithPg('0010_proposal_action_payload_index migration', () => {
  it('round-trips proposal_action payload_index and unique constraints', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await upProposalActionPayloadIndex(tx);

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

        const legacyConstraintBeforeDown = await tx
          .selectFrom('pg_constraint')
          .select('conname')
          .where('conname', '=', 'proposal_action_proposal_id_action_index_key')
          .execute();
        expect(legacyConstraintBeforeDown).toEqual([]);

        await downProposalActionPayloadIndex(tx);

        const payloadIndexAfterDown = await tx
          .selectFrom('information_schema.columns')
          .select('column_name')
          .where('table_name', '=', 'proposal_action')
          .where('column_name', '=', 'payload_index')
          .execute();
        expect(payloadIndexAfterDown).toEqual([]);

        const legacyConstraintAfterDown = await tx
          .selectFrom('pg_constraint')
          .select('conname')
          .where('conname', '=', 'proposal_action_proposal_id_action_index_key')
          .execute();
        expect(legacyConstraintAfterDown).toEqual([
          { conname: 'proposal_action_proposal_id_action_index_key' },
        ]);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
