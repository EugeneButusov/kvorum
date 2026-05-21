import { chDb } from '@libs/db';

const describeWithCh = process.env['CLICKHOUSE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await chDb.destroy();
});

type ColumnRow = { table: string; name: string; type: string; default_kind: string };
type TableRow = { name: string; engine_full: string; sorting_key: string; partition_key: string };
const clickhouseDbName = process.env['CLICKHOUSE_DATABASE'] ?? 'default';

async function fetchColumns(): Promise<Map<string, ColumnRow[]>> {
  const result = await chDb
    .selectFrom('system.columns' as never)
    .select(['table' as never, 'name' as never, 'type' as never, 'default_kind' as never])
    .where('database' as never, '=', clickhouseDbName)
    .where('table' as never, 'in', ['vote_events_analytics', 'delegation_flow_analytics'])
    .orderBy('table' as never)
    .orderBy('position' as never)
    .execute();

  const byTable = new Map<string, ColumnRow[]>();
  for (const row of result as ColumnRow[]) {
    const list = byTable.get(row.table) ?? [];
    list.push(row);
    byTable.set(row.table, list);
  }

  return byTable;
}

async function fetchTables(): Promise<Map<string, TableRow>> {
  const result = await chDb
    .selectFrom('system.tables' as never)
    .select([
      'name' as never,
      'engine_full' as never,
      'sorting_key' as never,
      'partition_key' as never,
    ])
    .where('database' as never, '=', clickhouseDbName)
    .where('name' as never, 'in', ['vote_events_analytics', 'delegation_flow_analytics'])
    .execute();

  return new Map((result as TableRow[]).map((r) => [r.name, r]));
}

describeWithCh('core_001_analytical_mirror migration', () => {
  it('creates vote_events_analytics with the locked 14-column shape (incl. ALIAS)', async () => {
    const byTable = await fetchColumns();
    const cols = byTable.get('vote_events_analytics') ?? [];

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

  it('creates delegation_flow_analytics with the locked 9-column shape', async () => {
    const byTable = await fetchColumns();
    const cols = byTable.get('delegation_flow_analytics') ?? [];

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
    const votes = tables.get('vote_events_analytics');
    const delegations = tables.get('delegation_flow_analytics');

    expect(votes?.engine_full).toMatch(/^ReplacingMergeTree\(cast_at\)/);
    expect(votes?.sorting_key).toBe('dao_id, proposal_id, voter_actor_id, vote_id');
    expect(votes?.partition_key).toBe('toYear(cast_at)');

    expect(delegations?.engine_full).toMatch(/^ReplacingMergeTree\(created_at\)/);
    expect(delegations?.sorting_key).toBe(
      'dao_id, delegator_actor_id, block_number, delegation_id',
    );
    expect(delegations?.partition_key).toBe('toYear(created_at)');
  });
});
