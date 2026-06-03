import type { Kysely } from 'kysely';
import { vi } from 'vitest';
import { chDb, pgDb } from '@libs/db';
import {
  down as downAaveExtensionTables,
  up as upAaveExtensionTables,
} from '../migrations-postgres/aave_001_extension_tables';
import {
  AAVE_GOVERNANCE_V3_DEPLOY_BLOCK,
  AAVE_GOVERNOR_V2_DEPLOY_BLOCK,
  down as downAaveSeed,
  up as upAaveSeed,
} from '../migrations-postgres/aave_002_seed';
import {
  down as downAaveMetadataNullable,
  up as upAaveMetadataNullable,
} from '../migrations-postgres/aave_003_metadata_voting_fields_nullable';

class RollbackSignal extends Error {}

describe('aave migrations smoke (mocked db)', () => {
  function makeMockDb() {
    const executeQuery = vi.fn().mockResolvedValue({ rows: [] });
    const makeColumnBuilder = () => ({
      primaryKey: vi.fn().mockReturnThis(),
      references: vi.fn().mockReturnThis(),
      onDelete: vi.fn().mockReturnThis(),
      notNull: vi.fn().mockReturnThis(),
      defaultTo: vi.fn().mockReturnThis(),
      dropNotNull: vi.fn().mockReturnThis(),
      setNotNull: vi.fn().mockReturnThis(),
    });
    const makeSchemaAction = () => ({
      addColumn: vi
        .fn()
        .mockImplementation((_: unknown, __: unknown, callback?: (column: unknown) => unknown) => {
          callback?.(makeColumnBuilder());
          return makeSchemaAction();
        }),
      createTable: vi.fn().mockReturnThis(),
      createIndex: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
      column: vi.fn().mockReturnThis(),
      alterColumn: vi
        .fn()
        .mockImplementation((_: unknown, callback?: (column: unknown) => unknown) => {
          callback?.(makeColumnBuilder());
          return makeSchemaAction();
        }),
      addUniqueConstraint: vi.fn().mockReturnThis(),
      dropColumn: vi.fn().mockReturnThis(),
      dropTable: vi.fn().mockReturnThis(),
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
        createTable: vi.fn().mockImplementation(() => makeSchemaAction()),
        alterTable: vi.fn().mockImplementation(() => makeSchemaAction()),
        createIndex: vi.fn().mockImplementation(() => makeSchemaAction()),
        dropIndex: vi.fn().mockImplementation(() => makeSchemaAction()),
        dropTable: vi.fn().mockImplementation(() => makeSchemaAction()),
      },
      _executeQuery: executeQuery,
    } as unknown as Kysely<unknown> & { _executeQuery: ReturnType<typeof vi.fn> };
  }

  it('aave_001_extension_tables up fires schema queries', async () => {
    const db = makeMockDb();
    await upAaveExtensionTables(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('aave_001_extension_tables down fires schema queries', async () => {
    const db = makeMockDb();
    await downAaveExtensionTables(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('aave_002_seed up fires sql.execute calls', async () => {
    const db = makeMockDb();
    await upAaveSeed(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('aave_002_seed down fires sql.execute calls', async () => {
    const db = makeMockDb();
    await downAaveSeed(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });

  it('aave_003_metadata_voting_fields_nullable up/down fire schema queries', async () => {
    const db = makeMockDb();
    await upAaveMetadataNullable(db);
    await downAaveMetadataNullable(db);
    expect(db._executeQuery).toHaveBeenCalled();
  });
});

const describeWithPg = process.env['DATABASE_URL'] != null ? describe : describe.skip;
const describeWithCh = process.env['CLICKHOUSE_URL'] != null ? describe : describe.skip;
const clickhouseDbName = process.env['CLICKHOUSE_DATABASE'] ?? 'default';

afterAll(async () => {
  await pgDb.destroy();
  await chDb.destroy();
});

describeWithPg('aave_002_seed migration', () => {
  it('inserts Aave dao, source types, and configured dao_source rows', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await upAaveSeed(tx);

        const daoRows = await tx
          .selectFrom('dao')
          .select(['slug', 'primary_token_address', 'primary_chain_id'])
          .where('slug', '=', 'aave')
          .execute();
        expect(daoRows).toHaveLength(1);
        expect(daoRows[0]?.slug).toBe('aave');
        expect(daoRows[0]?.primary_token_address).toBe(
          '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
        );
        expect(daoRows[0]?.primary_chain_id).toBe('0x1');

        const sourceRows = await tx
          .selectFrom('dao_source')
          .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
          .select(['dao_source.source_type', 'dao_source.chain_id', 'dao_source.active_from_block'])
          .where('dao.slug', '=', 'aave')
          .execute();

        expect(sourceRows).toHaveLength(21);
        expect(sourceRows).toContainEqual({
          source_type: 'aave_governance_v3',
          chain_id: '0x1',
          active_from_block: String(AAVE_GOVERNANCE_V3_DEPLOY_BLOCK),
        });
        expect(sourceRows).toContainEqual({
          source_type: 'aave_governor_v2',
          chain_id: '0x1',
          active_from_block: String(AAVE_GOVERNOR_V2_DEPLOY_BLOCK),
        });

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});

describeWithPg('aave_003_metadata_voting_fields_nullable migration', () => {
  it('makes voting machine metadata columns nullable', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await upAaveMetadataNullable(tx);

        const rows = await tx
          .selectFrom('information_schema.columns')
          .select(['column_name', 'is_nullable'])
          .where('table_name', '=', 'aave_proposal_metadata')
          .where('column_name', 'in', ['voting_machine_address', 'voting_chain_id'])
          .execute();

        expect(rows).toEqual(
          expect.arrayContaining([
            { column_name: 'voting_chain_id', is_nullable: 'YES' },
            { column_name: 'voting_machine_address', is_nullable: 'YES' },
          ]),
        );

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});

describeWithPg('aave_001_extension_tables migration', () => {
  it('creates last_reconcile_check_block with its index', async () => {
    const columns = await pgDb
      .selectFrom('information_schema.columns')
      .select(['column_name'])
      .where('table_name', '=', 'aave_proposal_metadata')
      .where('column_name', '=', 'last_reconcile_check_block')
      .execute();
    expect(columns).toEqual([{ column_name: 'last_reconcile_check_block' }]);

    const indexes = await pgDb
      .selectFrom('pg_indexes')
      .select(['indexname'])
      .where('tablename', '=', 'aave_proposal_metadata')
      .where('indexname', '=', 'idx_aave_proposal_metadata_recheck')
      .execute();
    expect(indexes).toEqual([{ indexname: 'idx_aave_proposal_metadata_recheck' }]);
  });
});

type TableRow = {
  name: string;
  engine_full: string;
  sorting_key: string;
  partition_key: string;
};

describeWithCh('aave ClickHouse archive migration', () => {
  it('creates archive tables with ReplacingMergeTree and chain partitions', async () => {
    const names = [
      'archive_event_aave_governance_v3',
      'archive_event_aave_voting_machine',
      'archive_event_aave_payloads_controller',
      'archive_event_aave_governor_v2',
    ];
    const rows = (await chDb
      .selectFrom('system.tables' as never)
      .select([
        'name' as never,
        'engine_full' as never,
        'sorting_key' as never,
        'partition_key' as never,
      ])
      .where('database' as never, '=', clickhouseDbName)
      .where('name' as never, 'in', names)
      .execute()) as TableRow[];

    const tables = new Map(rows.map((row) => [row.name, row]));
    for (const name of names) {
      const table = tables.get(name);
      expect(table?.engine_full).toMatch(/^ReplacingMergeTree/);
      expect(table?.partition_key).toBe('chain_id');
      expect(table?.sorting_key).toBe('chain_id, block_number, tx_hash, log_index, block_hash');
    }
  });
});
