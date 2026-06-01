import { chDb } from '@libs/db';

const describeWithCh = process.env['CLICKHOUSE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await chDb.destroy();
});

type TableRow = {
  name: string;
  engine: string;
  engine_full: string;
  sorting_key: string;
  partition_key: string;
};
const clickhouseDbName = process.env['CLICKHOUSE_DATABASE'] ?? 'default';

async function fetchTables(names: string[]): Promise<Map<string, TableRow>> {
  const result = await chDb
    .selectFrom('system.tables' as never)
    .select([
      'name' as never,
      'engine' as never,
      'engine_full' as never,
      'sorting_key' as never,
      'partition_key' as never,
    ])
    .where('database' as never, '=', clickhouseDbName)
    .where('name' as never, 'in', names)
    .execute();

  return new Map((result as TableRow[]).map((r) => [r.name, r]));
}

async function hasDictionary(name: string): Promise<boolean> {
  const result = await chDb
    .selectFrom('system.dictionaries' as never)
    .select(['name' as never])
    .where('database' as never, '=', clickhouseDbName)
    .where('name' as never, '=', name)
    .execute();

  return result.length > 0;
}

type ColumnRow = {
  table: string;
  name: string;
  default_expression: string;
};

async function fetchColumn(table: string, name: string): Promise<ColumnRow | undefined> {
  const result = await chDb
    .selectFrom('system.columns' as never)
    .select(['table' as never, 'name' as never, 'default_expression' as never])
    .where('database' as never, '=', clickhouseDbName)
    .where('table' as never, '=', table)
    .where('name' as never, '=', name)
    .execute();

  return (result as ColumnRow[])[0];
}

describeWithCh('core_001_ch_source_of_truth migration', () => {
  it('creates raw MergeTree tables with expected engines and keys', async () => {
    const tables = await fetchTables([
      'vote_events_raw',
      'delegation_flow_raw',
      'voting_power_snapshot_raw',
    ]);

    const votes = tables.get('vote_events_raw');
    expect(votes?.engine_full).toMatch(/^MergeTree/);
    expect(votes?.sorting_key).toBe(
      'dao_id, proposal_id, voter_address, block_number, log_index, vote_id',
    );
    expect(votes?.partition_key).toBe('toYYYYMM(cast_at)');

    const delegations = tables.get('delegation_flow_raw');
    expect(delegations?.engine_full).toMatch(/^MergeTree/);
    expect(delegations?.sorting_key).toBe(
      'dao_id, delegator_address, block_number, log_index, delegation_id',
    );
    expect(delegations?.partition_key).toBe('toYYYYMM(created_at)');

    const snapshots = tables.get('voting_power_snapshot_raw');
    expect(snapshots?.engine_full).toMatch(/^MergeTree/);
    expect(snapshots?.sorting_key).toBe('dao_id, proposal_id, actor_address');
    expect(snapshots?.partition_key).toBe('toYYYYMM(computed_at)');
  });

  it('creates AggregatingMergeTree tables with expected keys', async () => {
    const tables = await fetchTables([
      'vote_events_agg',
      'delegation_flow_agg',
      'voting_power_snapshot_agg',
    ]);

    const votes = tables.get('vote_events_agg');
    expect(votes?.engine_full).toMatch(/^AggregatingMergeTree/);
    expect(votes?.sorting_key).toBe(
      'dao_id, proposal_id, voter_address, block_number, log_index, vote_id, voting_chain_id',
    );

    const delegations = tables.get('delegation_flow_agg');
    expect(delegations?.engine_full).toMatch(/^AggregatingMergeTree/);
    expect(delegations?.sorting_key).toBe(
      'dao_id, delegator_address, block_number, log_index, delegation_id',
    );

    const snapshots = tables.get('voting_power_snapshot_agg');
    expect(snapshots?.engine_full).toMatch(/^AggregatingMergeTree/);
    expect(snapshots?.sorting_key).toBe('dao_id, proposal_id, actor_address');
  });

  it('creates projection VIEWs and materialized views', async () => {
    const tables = await fetchTables([
      'vote_events_projection',
      'delegation_flow_projection',
      'voting_power_snapshot_projection',
      'vote_events_mv',
      'delegation_flow_mv',
      'voting_power_snapshot_mv',
    ]);

    // Use engine (not engine_full) — ClickHouse returns '' for engine_full on views/MVs
    expect(tables.get('vote_events_projection')?.engine).toBe('View');
    expect(tables.get('delegation_flow_projection')?.engine).toBe('View');
    expect(tables.get('voting_power_snapshot_projection')?.engine).toBe('View');
    expect(tables.get('vote_events_mv')?.engine).toBe('MaterializedView');
    expect(tables.get('delegation_flow_mv')?.engine).toBe('MaterializedView');
    expect(tables.get('voting_power_snapshot_mv')?.engine).toBe('MaterializedView');
  });

  it('adds voting_chain_id to vote projection and keeps raw default', async () => {
    const projectionColumn = await fetchColumn('vote_events_projection', 'voting_chain_id');
    expect(projectionColumn?.name).toBe('voting_chain_id');

    const rawColumn = await fetchColumn('vote_events_raw', 'voting_chain_id');
    expect(rawColumn?.default_expression).toBe("'0x1'");
  });

  it('creates actor_address_redirect dictionary', async () => {
    await expect(hasDictionary('actor_address_redirect')).resolves.toBe(true);
  });
});
