import { sql } from 'kysely';
import { chDb } from '@libs/db';

const describeWithCh = process.env['CLICKHOUSE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await chDb.destroy();
});

type ColumnRow = { table: string; name: string; type: string; default_kind: string };
type TableRow = { name: string; engine_full: string; sorting_key: string; partition_key: string };

async function fetchColumns(): Promise<Map<string, ColumnRow[]>> {
  const result = await sql<ColumnRow>`
    SELECT table, name, type, default_kind
    FROM system.columns
    WHERE database = currentDatabase()
      AND table IN ('vote_events_flat', 'delegation_flow_flat')
    ORDER BY table, position
  `.execute(chDb);

  const byTable = new Map<string, ColumnRow[]>();
  for (const row of result.rows) {
    const list = byTable.get(row.table) ?? [];
    list.push(row);
    byTable.set(row.table, list);
  }

  return byTable;
}

async function fetchTables(): Promise<Map<string, TableRow>> {
  const result = await sql<TableRow>`
    SELECT name, engine_full, sorting_key, partition_key
    FROM system.tables
    WHERE database = currentDatabase()
      AND name IN ('vote_events_flat', 'delegation_flow_flat')
  `.execute(chDb);

  return new Map(result.rows.map((r) => [r.name, r]));
}

describeWithCh('core_001_analytical_mirror migration', () => {
  it('creates vote_events_flat with the locked 14-column shape (incl. ALIAS)', async () => {
    const byTable = await fetchColumns();
    const cols = byTable.get('vote_events_flat') ?? [];

    expect(cols.map((c) => c.name)).toEqual([
      'vote_id',
      'proposal_id',
      'voter_actor_id',
      'voter_address',
      'dao_id',
      'dao_slug',
      'source_type',
      'primary_choice',
      'primary_choice_nullable',
      'voting_power',
      'cast_at',
      'created_at',
      'block_number',
      'superseded',
    ]);

    const colsByName = new Map(cols.map((c) => [c.name, c.type]));
    const kindByName = new Map(cols.map((c) => [c.name, c.default_kind]));
    expect(colsByName.get('voting_power')).toMatch(/^UInt256/);
    expect(colsByName.get('voter_address')).toBe('FixedString(42)');
    expect(colsByName.get('primary_choice')).toBe('Int8');
    expect(colsByName.get('superseded')).toBe('UInt8');
    expect(kindByName.get('primary_choice_nullable')).toBe('ALIAS');
    expect(kindByName.get('primary_choice')).toBe('');
  });

  it('creates delegation_flow_flat with the locked 9-column shape', async () => {
    const byTable = await fetchColumns();
    const cols = byTable.get('delegation_flow_flat') ?? [];

    expect(cols.map((c) => c.name)).toEqual([
      'delegation_id',
      'delegator_actor_id',
      'delegate_actor_id',
      'dao_id',
      'dao_slug',
      'voting_power',
      'block_number',
      'event_type',
      'created_at',
    ]);

    const colsByName = new Map(cols.map((c) => [c.name, c.type]));
    expect(colsByName.get('voting_power')).toMatch(/^UInt256/);
    expect(colsByName.get('event_type')).toMatch(/^LowCardinality\(String\)/);
  });

  it('locks engine, sorting_key, and partition_key on both tables', async () => {
    const tables = await fetchTables();
    const votes = tables.get('vote_events_flat');
    const delegations = tables.get('delegation_flow_flat');

    expect(votes?.engine_full).toMatch(/^ReplacingMergeTree\(cast_at\)/);
    expect(votes?.sorting_key).toBe('dao_id, proposal_id, voter_actor_id, vote_id');
    expect(votes?.partition_key).toBe('toYYYY(cast_at)');

    expect(delegations?.engine_full).toMatch(/^ReplacingMergeTree\(created_at\)/);
    expect(delegations?.sorting_key).toBe(
      'dao_id, delegator_actor_id, block_number, delegation_id',
    );
    expect(delegations?.partition_key).toBe('toYYYY(created_at)');
  });
});
