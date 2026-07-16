import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalyticsReadRepository, bucketGrid } from './analytics-read-repository';
import { chDb, pgDb } from './client';
import { DelegationFlowProjectionWriter } from './delegation-flow-projection-writer';

const describeWithDbAndCh =
  process.env['DATABASE_URL'] != null && process.env['CLICKHOUSE_URL'] != null
    ? describe
    : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
  await chDb.destroy();
});

const ZERO = '0x0000000000000000000000000000000000000000';
const addr = (n: string) => '0x' + n.repeat(40).slice(0, 40);

async function seedDao() {
  return pgDb
    .insertInto('dao')
    .values({
      slug: `conc-${randomUUID().slice(0, 8)}`,
      name: 'Concentration Integration',
      primary_token_address: '0x' + '00'.repeat(20),
      primary_chain_id: '0x1',
      description: 'integration test',
      website_url: 'https://example.com',
      forum_url: 'https://forum.example.com',
      updated_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

// Concentration is a STANDING distribution per bucket, aggregated per delegate. The previous query
// aggregated raw delegation events, which (a) counted a delegator once per event they ever made,
// (b) never grouped by delegate, and (c) only produced buckets that happened to contain events.
// These are exercised against a real ClickHouse because the bug is entirely in the SQL shape.
describeWithDbAndCh('concentration = standing distribution per delegate (integration)', () => {
  it('counts a re-delegating delegator once, at their latest delegation', async () => {
    const dao = await seedDao();
    // One delegator, three events: 100 → 100 → 300 (a top-up). Standing power is 300, not 500.
    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('a'),
        delegate_address: addr('d'),
        voting_power: '100',
        block_number: '1',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-10T00:00:00.000Z'),
      },
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('a'),
        delegate_address: addr('d'),
        voting_power: '100',
        block_number: '2',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-20T00:00:00.000Z'),
      },
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('a'),
        delegate_address: addr('d'),
        voting_power: '300',
        block_number: '3',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-25T00:00:00.000Z'),
      },
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const result = await repo.concentrationByBucket({
        daoId: dao.id,
        from: new Date('2026-03-01T00:00:00.000Z'),
        to: new Date('2026-03-31T23:59:59.000Z'),
        bucket: 'monthly',
      });

      expect(result.rows).toHaveLength(1);
      // The bug summed every event: 100+100+300 = 500, with delegate_count 3.
      expect(result.rows[0]!.total_voting_power).toBe('300');
      expect(result.rows[0]!.weights).toEqual(['300']);
      expect(result.rows[0]!.delegate_count).toBe(1);
    } finally {
      await sql`ALTER TABLE delegation_flow_raw DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await sql`ALTER TABLE delegation_flow_agg DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await pgDb.deleteFrom('dao').where('id', '=', dao.id).execute();
    }
  });

  it('sums power per delegate and reports it as the weight vector', async () => {
    const dao = await seedDao();
    // Two delegators back delegate D (100 + 50); one backs delegate E (25).
    // Weights must be per delegate — [25, 150] — not the three raw event amounts.
    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('a'),
        delegate_address: addr('d'),
        voting_power: '100',
        block_number: '1',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-10T00:00:00.000Z'),
      },
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('b'),
        delegate_address: addr('d'),
        voting_power: '50',
        block_number: '2',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-11T00:00:00.000Z'),
      },
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('c'),
        delegate_address: addr('e'),
        voting_power: '25',
        block_number: '3',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-12T00:00:00.000Z'),
      },
      // Undelegation to the zero address is not a delegate holding power.
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('f'),
        delegate_address: ZERO,
        voting_power: '999',
        block_number: '4',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-13T00:00:00.000Z'),
      },
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const result = await repo.concentrationByBucket({
        daoId: dao.id,
        from: new Date('2026-03-01T00:00:00.000Z'),
        to: new Date('2026-03-31T23:59:59.000Z'),
        bucket: 'monthly',
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.weights).toEqual(['25', '150']);
      expect(result.rows[0]!.total_voting_power).toBe('175');
      expect(result.rows[0]!.delegate_count).toBe(2);
    } finally {
      await sql`ALTER TABLE delegation_flow_raw DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await sql`ALTER TABLE delegation_flow_agg DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await pgDb.deleteFrom('dao').where('id', '=', dao.id).execute();
    }
  });

  it('carries a standing delegation into later buckets that saw no events', async () => {
    const dao = await seedDao();
    // A single delegation in March. April and May had no events at all, but the power still stands —
    // the old query emitted only the March bucket, collapsing the chart to one point.
    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('a'),
        delegate_address: addr('d'),
        voting_power: '100',
        block_number: '1',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-10T00:00:00.000Z'),
      },
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const result = await repo.concentrationByBucket({
        daoId: dao.id,
        from: new Date('2026-03-01T00:00:00.000Z'),
        to: new Date('2026-05-31T23:59:59.000Z'),
        bucket: 'monthly',
      });

      expect(result.rows.map((r) => r.bucket.toISOString().slice(0, 7))).toEqual([
        '2026-03',
        '2026-04',
        '2026-05',
      ]);
      expect(result.rows.map((r) => r.total_voting_power)).toEqual(['100', '100', '100']);
    } finally {
      await sql`ALTER TABLE delegation_flow_raw DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await sql`ALTER TABLE delegation_flow_agg DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await pgDb.deleteFrom('dao').where('id', '=', dao.id).execute();
    }
  });

  it('reflects a delegation moving between delegates over time', async () => {
    const dao = await seedDao();
    // Power moves from D to E in April: March shows D, April+ show E. Never both.
    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('a'),
        delegate_address: addr('d'),
        voting_power: '100',
        block_number: '1',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-10T00:00:00.000Z'),
      },
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: addr('a'),
        delegate_address: addr('e'),
        voting_power: '100',
        block_number: '2',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-04-10T00:00:00.000Z'),
      },
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const result = await repo.concentrationByBucket({
        daoId: dao.id,
        from: new Date('2026-03-01T00:00:00.000Z'),
        to: new Date('2026-04-30T23:59:59.000Z'),
        bucket: 'monthly',
      });

      // One delegate holding 100 in each bucket — the total must never double-count the move.
      expect(result.rows.map((r) => r.total_voting_power)).toEqual(['100', '100']);
      expect(result.rows.map((r) => r.delegate_count)).toEqual([1, 1]);
    } finally {
      await sql`ALTER TABLE delegation_flow_raw DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await sql`ALTER TABLE delegation_flow_agg DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await pgDb.deleteFrom('dao').where('id', '=', dao.id).execute();
    }
  });
});

describe('bucketGrid', () => {
  it('aligns monthly buckets to the first of the month', () => {
    expect(
      bucketGrid(new Date('2026-03-15T12:00:00Z'), new Date('2026-05-02T00:00:00Z'), 'monthly').map(
        (d) => d.toISOString(),
      ),
    ).toEqual(['2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z']);
  });

  it('aligns weekly buckets to Sunday, matching ClickHouse toStartOfWeek', () => {
    // 2026-03-18 is a Wednesday; its week starts Sunday 2026-03-15.
    expect(
      bucketGrid(new Date('2026-03-18T00:00:00Z'), new Date('2026-03-29T00:00:00Z'), 'weekly').map(
        (d) => d.toISOString(),
      ),
    ).toEqual(['2026-03-15T00:00:00.000Z', '2026-03-22T00:00:00.000Z', '2026-03-29T00:00:00.000Z']);
  });

  it('emits one bucket per day', () => {
    expect(
      bucketGrid(new Date('2026-03-01T06:00:00Z'), new Date('2026-03-03T23:00:00Z'), 'daily'),
    ).toHaveLength(3);
  });

  it('returns nothing when the range is inverted', () => {
    expect(bucketGrid(new Date('2026-03-05'), new Date('2026-03-01'), 'daily')).toEqual([]);
  });
});
