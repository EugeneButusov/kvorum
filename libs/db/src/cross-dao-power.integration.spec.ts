import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalyticsReadRepository } from './analytics-read-repository';
import { chDb, pgDb } from './client';
import { DelegationFlowProjectionWriter } from './delegation-flow-projection-writer';
import { VoteEventsProjectionWriter } from './vote-events-projection-writer';

const describeWithDbAndCh =
  process.env['DATABASE_URL'] != null && process.env['CLICKHOUSE_URL'] != null
    ? describe
    : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
  await chDb.destroy();
});

const addr = () => '0x' + (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40);

/**
 * Voting power on the cross-DAO actor summary, against a real Postgres + ClickHouse.
 *
 * `current_voting_power` was hardcoded `'0'` in the API mapper and never computed, and the summary
 * itself was built purely from votes — so a delegate who holds power but has never voted appeared in
 * no DAO at all. That combination is why a delegate scorecard showed blank participation, blank power
 * and blank alignment for the top delegate in Compound, who holds 46.73% of delegated power and has
 * cast no votes.
 *
 * Power here means power delegated TO the actor, which is what the delegate leaderboard ranks on.
 * The actor's own token balance is not available: that projection was retired in M3.
 */
describeWithDbAndCh('cross-DAO actor summary: voting power (integration)', () => {
  async function seedDao(prefix: string) {
    return pgDb
      .insertInto('dao')
      .values({
        slug: `${prefix}-${randomUUID().slice(0, 8)}`,
        name: 'Cross DAO Power Integration',
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

  async function seedActor(addresses: readonly string[]) {
    const primary = addresses[0]!;
    const actor = await pgDb
      .insertInto('actor')
      .values({ primary_address: primary, updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    await pgDb
      .insertInto('actor_address')
      .values(
        addresses.map((address, index) => ({
          actor_id: actor.id,
          address,
          is_primary: index === 0,
          source: 'manual' as const,
        })),
      )
      .execute();
    return actor.id;
  }

  function flowRow(over: {
    daoId: string;
    delegator: string;
    delegate: string;
    vp: string;
    block: string;
    at: string;
  }) {
    return {
      delegation_id: randomUUID(),
      dao_id: over.daoId,
      delegator_address: over.delegator,
      delegate_address: over.delegate,
      voting_power: over.vp,
      block_number: over.block,
      log_index: 0,
      event_type: 'delegate_changed' as const,
      created_at: new Date(over.at),
    };
  }

  async function cleanup(daoId: string, actorIds: string[], proposalIds: string[] = []) {
    await sql`ALTER TABLE delegation_flow_raw DELETE WHERE dao_id = ${daoId}`.execute(chDb);
    await sql`ALTER TABLE delegation_flow_agg DELETE WHERE dao_id = ${daoId}`.execute(chDb);
    await sql`ALTER TABLE vote_events_raw DELETE WHERE dao_id = ${daoId}`.execute(chDb);
    if (proposalIds.length > 0) {
      await pgDb.deleteFrom('proposal').where('id', 'in', proposalIds).execute();
    }
    await pgDb.deleteFrom('actor_address').where('actor_id', 'in', actorIds).execute();
    await pgDb.deleteFrom('actor').where('id', 'in', actorIds).execute();
    await pgDb.deleteFrom('dao').where('id', '=', daoId).execute();
  }

  it('reports a delegate that holds power but has never voted, instead of omitting it', async () => {
    // The exact shape of the reported bug: an actor created by a delegate_event, never a voter.
    const dao = await seedDao('power-novote');
    const delegateAddress = addr();
    const delegateActorId = await seedActor([delegateAddress]);
    const delegatorAddress = addr();
    const delegatorActorId = await seedActor([delegatorAddress]);

    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      flowRow({
        daoId: dao.id,
        delegator: delegatorAddress,
        delegate: delegateAddress,
        vp: '1535168178865433539246018',
        block: '1',
        at: '2026-03-01T00:00:00.000Z',
      }),
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const { rows } = await repo.crossDaoSummaryForActor(delegateActorId);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.dao_id).toBe(dao.id);
      // Exact UInt256 as a string — this is well past Number.MAX_SAFE_INTEGER.
      expect(rows[0]!.current_voting_power).toBe('1535168178865433539246018');
      // Honest zero, not a blank: the delegate genuinely has not voted.
      expect(rows[0]!.votes_cast).toBe(0);
      expect(rows[0]!.last_active_at).toBeNull();
    } finally {
      await cleanup(dao.id, [delegateActorId, delegatorActorId]);
    }
  });

  it('agrees with the figure the delegate leaderboard ranks on', async () => {
    // Both reduce to each delegator's latest power-bearing delegation. If they diverged, a delegate
    // page and the leaderboard it is reached from would show different numbers for the same actor.
    const dao = await seedDao('power-agree');
    const delegateAddress = addr();
    const delegateActorId = await seedActor([delegateAddress]);
    const [d1, d2] = [addr(), addr()];
    const otherActorId = await seedActor([d1]);

    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      // d1 re-delegates: only the later 100 counts, not 40 on top.
      flowRow({
        daoId: dao.id,
        delegator: d1,
        delegate: delegateAddress,
        vp: '40',
        block: '1',
        at: '2026-03-01T00:00:00.000Z',
      }),
      flowRow({
        daoId: dao.id,
        delegator: d1,
        delegate: delegateAddress,
        vp: '100',
        block: '2',
        at: '2026-03-02T00:00:00.000Z',
      }),
      flowRow({
        daoId: dao.id,
        delegator: d2,
        delegate: delegateAddress,
        vp: '25',
        block: '3',
        at: '2026-03-03T00:00:00.000Z',
      }),
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const summary = await repo.crossDaoSummaryForActor(delegateActorId);
      const board = await repo.delegateLeaderboard({ daoId: dao.id, limit: 10 });
      const boardRow = board.rows.find((row) => row.actor_id === delegateActorId);

      expect(summary.rows[0]!.current_voting_power).toBe('125');
      expect(boardRow?.voting_power).toBe('125');
    } finally {
      await cleanup(dao.id, [delegateActorId, otherActorId]);
    }
  });

  it('sums power delegated to any address a merged actor owns', async () => {
    const dao = await seedDao('power-merged');
    const [primaryAddress, absorbedAddress] = [addr(), addr()];
    const mergedActorId = await seedActor([primaryAddress, absorbedAddress]);
    const [d1, d2] = [addr(), addr()];
    const otherActorId = await seedActor([d1]);

    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      flowRow({
        daoId: dao.id,
        delegator: d1,
        delegate: primaryAddress,
        vp: '60',
        block: '1',
        at: '2026-03-01T00:00:00.000Z',
      }),
      flowRow({
        daoId: dao.id,
        delegator: d2,
        delegate: absorbedAddress,
        vp: '55',
        block: '2',
        at: '2026-03-02T00:00:00.000Z',
      }),
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const { rows } = await repo.crossDaoSummaryForActor(mergedActorId);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.current_voting_power).toBe('115');
    } finally {
      await cleanup(dao.id, [mergedActorId, otherActorId]);
    }
  });

  it('reports zero power for a DAO the actor voted in but holds no delegation', async () => {
    const dao = await seedDao('power-voteonly');
    const voterAddress = addr();
    const voterActorId = await seedActor([voterAddress]);
    const proposal = await pgDb
      .insertInto('proposal')
      .values({
        dao_id: dao.id,
        proposer_actor_id: voterActorId,
        source_type: 'compound_governor_oz',
        source_id: randomUUID().slice(0, 8),
        title: 'integration',
        description: 'integration',
        description_hash: randomUUID().replace(/-/g, ''),
        binding: true,
        state: 'executed',
        state_updated_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await new VoteEventsProjectionWriter(chDb).insertBatch([
      {
        vote_id: randomUUID(),
        dao_id: dao.id,
        proposal_id: proposal.id,
        voter_address: voterAddress,
        voting_chain_id: '0x1',
        primary_choice: 1,
        voting_power: '1',
        cast_at: new Date('2026-03-01T00:00:00.000Z'),
        block_number: '1',
        log_index: 0,
        superseded: 0,
        superseded_at: null,
        superseded_by_vote_id: null,
      },
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const { rows } = await repo.crossDaoSummaryForActor(voterActorId);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.votes_cast).toBe(1);
      expect(rows[0]!.current_voting_power).toBe('0');
    } finally {
      await cleanup(dao.id, [voterActorId], [proposal.id]);
    }
  });
});
