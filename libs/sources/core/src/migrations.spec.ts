import { chDb } from '@libs/db';

const describeWithCh = process.env['CLICKHOUSE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await chDb.destroy();
});

type TableRow = { name: string; engine_full: string; sorting_key: string; partition_key: string };
const clickhouseDbName = process.env['CLICKHOUSE_DATABASE'] ?? 'default';

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
    .where('name' as never, 'in', [
      'vote_events_flat',
      'delegation_flow_flat',
      'voting_power_snapshot_flat',
    ])
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

describeWithCh('core_001_ch_source_of_truth migration', () => {
  it('creates flat tables with expected engines and keys', async () => {
    const tables = await fetchTables();

    const votes = tables.get('vote_events_flat');
    expect(votes?.engine_full).toMatch(/^ReplacingMergeTree\(version\)/);
    expect(votes?.sorting_key).toBe(
      'dao_id, proposal_id, voter_address, block_number, log_index, vote_id',
    );
    expect(votes?.partition_key).toBe('toYYYYMM(cast_at)');

    const delegations = tables.get('delegation_flow_flat');
    expect(delegations?.engine_full).toMatch(/^ReplacingMergeTree\(version\)/);
    expect(delegations?.sorting_key).toBe(
      'dao_id, delegator_address, block_number, log_index, delegation_id',
    );
    expect(delegations?.partition_key).toBe('toYYYYMM(created_at)');

    const snapshots = tables.get('voting_power_snapshot_flat');
    expect(snapshots?.engine_full).toMatch(/^ReplacingMergeTree\(version\)/);
    expect(snapshots?.sorting_key).toBe('dao_id, proposal_id, actor_address');
    expect(snapshots?.partition_key).toBe('toYYYYMM(computed_at)');
  });

  it('creates actor_address_redirect dictionary', async () => {
    await expect(hasDictionary('actor_address_redirect')).resolves.toBe(true);
  });
});
