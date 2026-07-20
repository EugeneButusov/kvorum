import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalyticsReadRepository } from './analytics-read-repository';
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

// Unique per run: actor.primary_address is globally unique, so fixed fixtures collide with rows
// left behind by an earlier failed run.
const addr = () => '0x' + (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40);

// delegateLeaderboard was written with raw sql`...`.execute(chDb), which resolves to zero rows
// against the ClickHouse dialect instead of erroring — so the endpoint returned an empty leaderboard
// for every DAO, silently. Only a real ClickHouse catches this: the mocked unit specs hand the repo
// whatever rows they please, and the dialect quirk is invisible to them.
describeWithDbAndCh('AnalyticsReadRepository.delegateLeaderboard (integration)', () => {
  it('ranks delegates by standing voting power, with delegator counts and an exact total', async () => {
    const [aAddr, bAddr, cAddr, dAddr, eAddr] = [addr(), addr(), addr(), addr(), addr()];
    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lb-${randomUUID().slice(0, 8)}`,
        name: 'Leaderboard Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: '0x1',
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Two actors, each with a delegate address the dictionary can resolve.
    const actorBig = await pgDb
      .insertInto('actor')
      .values({ primary_address: dAddr, updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const actorSmall = await pgDb
      .insertInto('actor')
      .values({ primary_address: eAddr, updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    await pgDb
      .insertInto('actor_address')
      .values([
        { actor_id: actorBig.id, address: dAddr, is_primary: true, source: 'manual' },
        { actor_id: actorSmall.id, address: eAddr, is_primary: true, source: 'manual' },
      ])
      .execute();

    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      // Delegate D: two delegators (100 + 50). The 100 delegator re-delegated, so their earlier
      // 40 must not be counted on top — standing power only.
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: aAddr,
        delegate_address: dAddr,
        voting_power: '40',
        block_number: '1',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: aAddr,
        delegate_address: dAddr,
        voting_power: '100',
        block_number: '2',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-05T00:00:00.000Z'),
      },
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: bAddr,
        delegate_address: dAddr,
        voting_power: '50',
        block_number: '3',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-06T00:00:00.000Z'),
      },
      // Delegate E: one delegator (25).
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: cAddr,
        delegate_address: eAddr,
        voting_power: '25',
        block_number: '4',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-07T00:00:00.000Z'),
      },
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const result = await repo.delegateLeaderboard({ daoId: dao.id, limit: 25 });

      // The bug returned { rows: [], totalVotingPower: '0' } here — a silently empty leaderboard.
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({
        actor_id: actorBig.id,
        voting_power: '150',
        delegator_count: 2,
      });
      expect(result.rows[1]).toEqual({
        actor_id: actorSmall.id,
        voting_power: '25',
        delegator_count: 1,
      });
      expect(result.totalVotingPower).toBe('175');
    } finally {
      await sql`ALTER TABLE delegation_flow_raw DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await sql`ALTER TABLE delegation_flow_agg DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await pgDb
        .deleteFrom('actor_address')
        .where('actor_id', 'in', [actorBig.id, actorSmall.id])
        .execute();
      await pgDb.deleteFrom('actor').where('id', 'in', [actorBig.id, actorSmall.id]).execute();
      await pgDb.deleteFrom('dao').where('id', '=', dao.id).execute();
    }
  });

  it('honours the limit while keeping the total across all delegates', async () => {
    const [aAddr, bAddr, dAddr, eAddr] = [addr(), addr(), addr(), addr()];
    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lb-${randomUUID().slice(0, 8)}`,
        name: 'Leaderboard Limit',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: '0x1',
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const big = await pgDb
      .insertInto('actor')
      .values({ primary_address: dAddr, updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const small = await pgDb
      .insertInto('actor')
      .values({ primary_address: eAddr, updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    await pgDb
      .insertInto('actor_address')
      .values([
        { actor_id: big.id, address: dAddr, is_primary: true, source: 'manual' },
        { actor_id: small.id, address: eAddr, is_primary: true, source: 'manual' },
      ])
      .execute();

    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: aAddr,
        delegate_address: dAddr,
        voting_power: '100',
        block_number: '1',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: bAddr,
        delegate_address: eAddr,
        voting_power: '25',
        block_number: '2',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-03-02T00:00:00.000Z'),
      },
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const result = await repo.delegateLeaderboard({ daoId: dao.id, limit: 1 });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.actor_id).toBe(big.id);
      // The share denominator must span every delegate, not just the returned page.
      expect(result.totalVotingPower).toBe('125');
    } finally {
      await sql`ALTER TABLE delegation_flow_raw DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await sql`ALTER TABLE delegation_flow_agg DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await pgDb.deleteFrom('actor_address').where('actor_id', 'in', [big.id, small.id]).execute();
      await pgDb.deleteFrom('actor').where('id', 'in', [big.id, small.id]).execute();
      await pgDb.deleteFrom('dao').where('id', '=', dao.id).execute();
    }
  });
});
