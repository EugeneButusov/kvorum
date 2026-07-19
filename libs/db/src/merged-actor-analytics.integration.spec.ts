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
 * Merged-actor behaviour of the six analytics reads, against a real Postgres + ClickHouse.
 *
 * Every one of these methods resolves address→actor, and a merged actor — one actor owning several
 * addresses — is the only case where that resolution does any work at all. Production currently has
 * **zero** merged actors, so no amount of production traffic exercises these paths; the unit specs
 * mock ClickHouse and hand the repository whatever rows they like. This suite is the only place the
 * behaviour is observable.
 *
 * It is written against the existing `actor_address_redirect` dictionary so that it encodes today's
 * semantics, and is meant to hold unchanged when resolution moves into the service (ADR-087). Where
 * today's answer is wrong, the test says so explicitly rather than enshrining it.
 */
describeWithDbAndCh('analytics reads: merged actors (integration)', () => {
  /** A DAO plus a merged actor (two addresses, one actor) and a single-address actor. */
  async function seedIdentities(namePrefix: string) {
    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `${namePrefix}-${randomUUID().slice(0, 8)}`,
        name: 'Merged Actor Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: '0x1',
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const [mergedPrimary, mergedAbsorbed, soloAddr] = [addr(), addr(), addr()];
    const merged = await pgDb
      .insertInto('actor')
      .values({ primary_address: mergedPrimary, updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const solo = await pgDb
      .insertInto('actor')
      .values({ primary_address: soloAddr, updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();

    // The shape executeMerge leaves behind: the absorbed address is retargeted onto the survivor,
    // so one actor owns two actor_address rows.
    await pgDb
      .insertInto('actor_address')
      .values([
        { actor_id: merged.id, address: mergedPrimary, is_primary: true, source: 'manual' },
        { actor_id: merged.id, address: mergedAbsorbed, is_primary: false, source: 'manual' },
        { actor_id: solo.id, address: soloAddr, is_primary: true, source: 'manual' },
      ])
      .execute();
    await sql`SYSTEM RELOAD DICTIONARY actor_address_redirect`.execute(chDb);

    return {
      daoId: dao.id,
      mergedActorId: merged.id,
      soloActorId: solo.id,
      mergedPrimary,
      mergedAbsorbed,
      soloAddr,
      actorIds: [merged.id, solo.id],
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

  function voteRow(over: {
    daoId: string;
    proposalId: string;
    voter: string;
    choice: number;
    at: string;
    block: string;
  }) {
    return {
      vote_id: randomUUID(),
      dao_id: over.daoId,
      proposal_id: over.proposalId,
      voter_address: over.voter,
      voting_chain_id: '0x1',
      primary_choice: over.choice,
      voting_power: '1',
      cast_at: new Date(over.at),
      block_number: over.block,
      log_index: 0,
      superseded: 0,
      superseded_at: null,
      superseded_by_vote_id: null,
    };
  }

  async function seedProposal(
    daoId: string,
    state: 'executed' | 'defeated',
    proposerActorId: string,
  ) {
    return pgDb
      .insertInto('proposal')
      .values({
        dao_id: daoId,
        proposer_actor_id: proposerActorId,
        source_type: 'compound_governor_oz',
        source_id: randomUUID().slice(0, 8),
        title: 'integration',
        description: 'integration',
        description_hash: randomUUID().replace(/-/g, ''),
        binding: true,
        state,
        state_updated_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  it('delegateLeaderboard sums a merged actor across its addresses before the top-N cut', async () => {
    // ADR-087's motivating case: the merged actor outranks everyone on the total (60 + 55 = 115),
    // but neither address alone would survive a top-2 taken by address.
    const s = await seedIdentities('lb-merged');
    const [d1, d2, d3, d4] = [addr(), addr(), addr(), addr()];
    const rival = await pgDb
      .insertInto('actor')
      .values({ primary_address: d4, updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    await pgDb
      .insertInto('actor_address')
      .values({ actor_id: rival.id, address: d4, is_primary: true, source: 'manual' })
      .execute();
    await sql`SYSTEM RELOAD DICTIONARY actor_address_redirect`.execute(chDb);

    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      flowRow({
        daoId: s.daoId,
        delegator: d1,
        delegate: s.mergedPrimary,
        vp: '60',
        block: '1',
        at: '2026-03-01T00:00:00.000Z',
      }),
      flowRow({
        daoId: s.daoId,
        delegator: d2,
        delegate: s.mergedAbsorbed,
        vp: '55',
        block: '2',
        at: '2026-03-02T00:00:00.000Z',
      }),
      flowRow({
        daoId: s.daoId,
        delegator: d3,
        delegate: s.soloAddr,
        vp: '100',
        block: '3',
        at: '2026-03-03T00:00:00.000Z',
      }),
      flowRow({
        daoId: s.daoId,
        delegator: d4,
        delegate: d4,
        vp: '90',
        block: '4',
        at: '2026-03-04T00:00:00.000Z',
      }),
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const result = await repo.delegateLeaderboard({ daoId: s.daoId, limit: 2 });

      expect(result.rows.map((r) => [r.actor_id, r.voting_power])).toEqual([
        [s.mergedActorId, '115'],
        [s.soloActorId, '100'],
      ]);
      // Both of the merged actor's delegators count towards it, as one delegate.
      expect(result.rows[0]!.delegator_count).toBe(2);
      // The denominator spans every delegate, page or not.
      expect(result.totalVotingPower).toBe('305');
    } finally {
      await cleanup(s.daoId, [...s.actorIds, rival.id]);
    }
  });

  it('delegationFlowEdges labels both endpoints of an edge with the surviving actor', async () => {
    const s = await seedIdentities('flow-merged');
    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      // The merged actor appears once under each of its addresses — once delegating out, once
      // receiving. Both edges must carry the same surviving actor id.
      flowRow({
        daoId: s.daoId,
        delegator: s.mergedAbsorbed,
        delegate: s.soloAddr,
        vp: '10',
        block: '1',
        at: '2026-03-01T00:00:00.000Z',
      }),
      flowRow({
        daoId: s.daoId,
        delegator: s.soloAddr,
        delegate: s.mergedPrimary,
        vp: '20',
        block: '2',
        at: '2026-03-02T00:00:00.000Z',
      }),
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const { rows } = await repo.delegationFlowEdges({
        daoId: s.daoId,
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2026-12-31T00:00:00.000Z'),
      });

      expect(rows).toHaveLength(2);
      expect(rows[0]!.delegator_actor_id).toBe(s.mergedActorId);
      expect(rows[0]!.delegate_actor_id).toBe(s.soloActorId);
      expect(rows[1]!.delegator_actor_id).toBe(s.soloActorId);
      expect(rows[1]!.delegate_actor_id).toBe(s.mergedActorId);
    } finally {
      await cleanup(s.daoId, s.actorIds);
    }
  });

  // Was KNOWN-031: this asserted the correct answer while the query returned 50, because
  // argMax over an actor-wide group yields only the most recently moved address. Resolution now
  // happens per address and folds in TypeScript, so the two standing figures sum as they should.
  it('currentVotingPowerByActor totals a merged actor across the addresses it delegates from', async () => {
    const s = await seedIdentities('vp-merged');
    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      // Each address has its own standing delegation, superseding an earlier value. The actor's
      // current power is the sum of the two standing figures: 100 + 50.
      flowRow({
        daoId: s.daoId,
        delegator: s.mergedPrimary,
        delegate: s.soloAddr,
        vp: '30',
        block: '1',
        at: '2026-03-01T00:00:00.000Z',
      }),
      flowRow({
        daoId: s.daoId,
        delegator: s.mergedPrimary,
        delegate: s.soloAddr,
        vp: '100',
        block: '2',
        at: '2026-03-02T00:00:00.000Z',
      }),
      flowRow({
        daoId: s.daoId,
        delegator: s.mergedAbsorbed,
        delegate: s.soloAddr,
        vp: '50',
        block: '3',
        at: '2026-03-03T00:00:00.000Z',
      }),
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const rows = await repo.currentVotingPowerByActor(s.daoId, [s.mergedActorId]);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_id).toBe(s.mergedActorId);
      expect(rows[0]!.voting_power).toBe('150');
    } finally {
      await cleanup(s.daoId, s.actorIds);
    }
  });

  it('crossDaoSummaryForActor returns one row per DAO for a merged actor, not one per address', async () => {
    const s = await seedIdentities('xdao-merged');
    const proposal = await seedProposal(s.daoId, 'executed', s.soloActorId);
    await new VoteEventsProjectionWriter(chDb).insertBatch([
      voteRow({
        daoId: s.daoId,
        proposalId: proposal.id,
        voter: s.mergedPrimary,
        choice: 1,
        at: '2026-03-01T00:00:00.000Z',
        block: '1',
      }),
      voteRow({
        daoId: s.daoId,
        proposalId: proposal.id,
        voter: s.mergedAbsorbed,
        choice: 1,
        at: '2026-03-02T00:00:00.000Z',
        block: '2',
      }),
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const { rows } = await repo.crossDaoSummaryForActor(s.mergedActorId);

      // Splitting into two rows here is the duplicate-DAO defect ADR-087 describes: votes_cast and
      // last_active_at would each be halved across them.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.voter_actor_id).toBe(s.mergedActorId);
      expect(rows[0]!.votes_cast).toBe(2);
    } finally {
      await cleanup(s.daoId, s.actorIds, [proposal.id]);
    }
  });

  it('alignmentWithMajorityForActor counts votes cast under either of a merged actor addresses', async () => {
    const s = await seedIdentities('align-merged');
    const passed = await seedProposal(s.daoId, 'executed', s.soloActorId);
    const failed = await seedProposal(s.daoId, 'defeated', s.soloActorId);
    await new VoteEventsProjectionWriter(chDb).insertBatch([
      // for on a proposal that passed → a match, cast under the primary address
      voteRow({
        daoId: s.daoId,
        proposalId: passed.id,
        voter: s.mergedPrimary,
        choice: 1,
        at: '2026-03-01T00:00:00.000Z',
        block: '1',
      }),
      // for on a proposal that failed → not a match, cast under the absorbed address
      voteRow({
        daoId: s.daoId,
        proposalId: failed.id,
        voter: s.mergedAbsorbed,
        choice: 1,
        at: '2026-03-02T00:00:00.000Z',
        block: '2',
      }),
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const result = await repo.alignmentWithMajorityForActor(s.mergedActorId, [s.daoId]);

      expect(result.get(s.daoId)).toEqual({ matches: 1, denom: 2 });
    } finally {
      await cleanup(s.daoId, s.actorIds, [passed.id, failed.id]);
    }
  });

  it('delegateAlignmentPage collapses a merged peer into one row and finds a focal actor by any address', async () => {
    const s = await seedIdentities('peer-merged');
    const proposalA = await seedProposal(s.daoId, 'executed', s.soloActorId);
    const proposalB = await seedProposal(s.daoId, 'executed', s.soloActorId);
    await new VoteEventsProjectionWriter(chDb).insertBatch([
      // Focal actor (solo) votes on both proposals.
      voteRow({
        daoId: s.daoId,
        proposalId: proposalA.id,
        voter: s.soloAddr,
        choice: 1,
        at: '2026-03-01T00:00:00.000Z',
        block: '1',
      }),
      voteRow({
        daoId: s.daoId,
        proposalId: proposalB.id,
        voter: s.soloAddr,
        choice: 1,
        at: '2026-03-02T00:00:00.000Z',
        block: '2',
      }),
      // The merged peer votes on one proposal under each address — one peer, two shared proposals.
      voteRow({
        daoId: s.daoId,
        proposalId: proposalA.id,
        voter: s.mergedPrimary,
        choice: 1,
        at: '2026-03-01T01:00:00.000Z',
        block: '3',
      }),
      voteRow({
        daoId: s.daoId,
        proposalId: proposalB.id,
        voter: s.mergedAbsorbed,
        choice: 0,
        at: '2026-03-02T01:00:00.000Z',
        block: '4',
      }),
    ]);

    try {
      const repo = new AnalyticsReadRepository(chDb, pgDb);
      const { rows } = await repo.delegateAlignmentPage({
        daoId: s.daoId,
        focalActorId: s.soloActorId,
        limit: 10,
        sort: 'vote_count',
        dir: 'desc',
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.peer_actor_id).toBe(s.mergedActorId);
      expect(rows[0]!.vote_count).toBe(2);
      expect(rows[0]!.shared_proposals).toBe(2);
      // Agreed on A, disagreed on B.
      expect(rows[0]!.matched_choices).toBe(1);
    } finally {
      await cleanup(s.daoId, s.actorIds, [proposalA.id, proposalB.id]);
    }
  });
});
