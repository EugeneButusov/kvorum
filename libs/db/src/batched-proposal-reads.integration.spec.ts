import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { chDb, pgDb } from './client';
import { ProposalReadRepository } from './proposal-read-repository';
import { VoteEventsProjectionWriter } from './vote-events-projection-writer';
import { VoteReadRepository } from './vote-read-repository';

const describeWithDbAndCh =
  process.env['DATABASE_URL'] != null && process.env['CLICKHOUSE_URL'] != null
    ? describe
    : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
  await chDb.destroy();
});

/**
 * The batched page reads behind the proposals-list tally summary.
 *
 * The mocked unit specs pin how the queries are built; they cannot prove the part that actually
 * matters here — that one query over a *page* of proposals keeps each proposal's votes and choices
 * separate. A `GROUP BY` that dropped `proposal_id`, or a grouping loop that overwrote instead of
 * appending, would still satisfy the mocks while silently merging two proposals' tallies. So this
 * seeds two proposals with deliberately different splits and asserts they come back apart.
 */
describeWithDbAndCh('batched proposal page reads (integration)', () => {
  async function seedTwoProposals() {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'compound_governor_bravo' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `batched-reads-${Date.now()}`,
        name: 'Batched Reads Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: '0x1',
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const actor = await pgDb
      .insertInto('actor')
      .values({ primary_address: '0x' + 'cd'.repeat(20), updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();

    const proposals = [];
    for (const sourceId of ['1', '2']) {
      const proposal = await pgDb
        .insertInto('proposal')
        .values({
          dao_id: dao.id,
          source_type: 'compound_governor_bravo',
          source_id: sourceId,
          proposer_actor_id: actor.id,
          title: `batched proposal ${sourceId}`,
          description: 'body',
          description_hash: `0x${sourceId.repeat(64)}`,
          binding: true,
          voting_starts_at: new Date('2026-05-20T00:00:00Z'),
          voting_ends_at: new Date('2026-05-23T00:00:00Z'),
          voting_starts_block: '100',
          voting_ends_block: '200',
          state: 'executed',
          state_updated_at: new Date('2026-05-24T00:00:00Z'),
          updated_at: new Date('2026-05-24T00:00:00Z'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      proposals.push(proposal.id);
    }

    return { daoId: dao.id, actorId: actor.id, proposalIds: proposals as [string, string] };
  }

  async function cleanup(ids: { daoId: string; actorId: string; proposalIds: readonly string[] }) {
    for (const proposalId of ids.proposalIds) {
      await sql`ALTER TABLE vote_events_raw DELETE WHERE proposal_id = ${proposalId}`.execute(chDb);
      await sql`ALTER TABLE vote_events_agg DELETE WHERE proposal_id = ${proposalId}`.execute(chDb);
    }
    await pgDb.deleteFrom('proposal').where('dao_id', '=', ids.daoId).execute();
    await pgDb.deleteFrom('actor').where('id', '=', ids.actorId).execute();
    await pgDb.deleteFrom('dao').where('id', '=', ids.daoId).execute();
  }

  it('tallyForProposals aggregates each proposal separately in one ClickHouse query', async () => {
    const seeded = await seedTwoProposals();
    const [first, second] = seeded.proposalIds;

    // Deliberately different splits, so a merged aggregate could not coincidentally look right.
    // p1: 700 against / 300 for. p2: 50 for only. One superseded vote on p1 must be ignored.
    const vote = (proposalId: string, choice: number, power: string, superseded = 0) => ({
      vote_id: randomUUID(),
      dao_id: seeded.daoId,
      proposal_id: proposalId,
      voter_address: '0x' + randomUUID().replace(/-/g, '').slice(0, 40),
      voting_chain_id: '0x1',
      primary_choice: choice,
      voting_power: power,
      cast_at: new Date('2026-05-21T00:00:00.000Z'),
      block_number: '100',
      log_index: 0,
      superseded,
      superseded_at: null,
      superseded_by_vote_id: null,
    });

    await new VoteEventsProjectionWriter(chDb).insertBatch([
      vote(first, 0, '400'),
      vote(first, 0, '300'),
      vote(first, 1, '300'),
      vote(first, 1, '999999', 1), // superseded — must not reach the tally
      vote(second, 1, '50'),
    ]);

    try {
      const out = await new VoteReadRepository(pgDb, chDb).tallyForProposals(seeded.proposalIds);

      expect(out.get(first)).toEqual(
        expect.arrayContaining([
          { primary_choice: 0, voting_power: '700', voter_count: 2 },
          { primary_choice: 1, voting_power: '300', voter_count: 1 },
        ]),
      );
      expect(out.get(first)).toHaveLength(2);
      // The second proposal keeps its own split — not merged with the first.
      expect(out.get(second)).toEqual([{ primary_choice: 1, voting_power: '50', voter_count: 1 }]);
    } finally {
      await cleanup(seeded);
    }
  });

  it('tallyForProposals keeps summed UInt256 power exact past Number.MAX_SAFE_INTEGER', async () => {
    const seeded = await seedTwoProposals();
    const [first] = seeded.proposalIds;
    const huge = '12345678901234567890123456789';

    await new VoteEventsProjectionWriter(chDb).insertBatch([
      {
        vote_id: randomUUID(),
        dao_id: seeded.daoId,
        proposal_id: first,
        voter_address: '0x' + 'ef'.repeat(20),
        voting_chain_id: '0x1',
        primary_choice: 1,
        voting_power: huge,
        cast_at: new Date('2026-05-21T00:00:00.000Z'),
        block_number: '100',
        log_index: 0,
        superseded: 0,
        superseded_at: null,
        superseded_by_vote_id: null,
      },
    ]);

    try {
      const out = await new VoteReadRepository(pgDb, chDb).tallyForProposals([first]);
      const power = out.get(first)?.[0]?.voting_power;

      // A bare UInt256 read would come back as a lossy JS number and stringify to "1.2345678901e+28".
      expect(typeof power).toBe('string');
      expect(power).toBe(huge);
      expect(BigInt(String(power))).toBe(BigInt(huge));
    } finally {
      await cleanup(seeded);
    }
  });

  it('tallyForProposals omits a proposal that has no votes', async () => {
    const seeded = await seedTwoProposals();
    const [first, second] = seeded.proposalIds;

    await new VoteEventsProjectionWriter(chDb).insertBatch([
      {
        vote_id: randomUUID(),
        dao_id: seeded.daoId,
        proposal_id: first,
        voter_address: '0x' + 'ab'.repeat(20),
        voting_chain_id: '0x1',
        primary_choice: 1,
        voting_power: '10',
        cast_at: new Date('2026-05-21T00:00:00.000Z'),
        block_number: '100',
        log_index: 0,
        superseded: 0,
        superseded_at: null,
        superseded_by_vote_id: null,
      },
    ]);

    try {
      const out = await new VoteReadRepository(pgDb, chDb).tallyForProposals(seeded.proposalIds);

      expect(out.has(first)).toBe(true);
      expect(out.has(second)).toBe(false);
    } finally {
      await cleanup(seeded);
    }
  });

  it('findChoicesForProposals groups a page by proposal, each ordered by choice_index', async () => {
    const seeded = await seedTwoProposals();
    const [first, second] = seeded.proposalIds;

    // Inserted out of order, so the ascending guarantee is actually exercised.
    await pgDb
      .insertInto('proposal_choice')
      .values([
        { proposal_id: first, choice_index: 2, value: 'abstain' },
        { proposal_id: first, choice_index: 0, value: 'against' },
        { proposal_id: first, choice_index: 1, value: 'for' },
        { proposal_id: second, choice_index: 1, value: 'for' },
        { proposal_id: second, choice_index: 0, value: 'against' },
      ])
      .execute();

    try {
      const out = await new ProposalReadRepository(pgDb).findChoicesForProposals(
        seeded.proposalIds,
      );

      expect(out.get(first)?.map((c) => [c.choice_index, c.value])).toEqual([
        [0, 'against'],
        [1, 'for'],
        [2, 'abstain'],
      ]);
      expect(out.get(second)?.map((c) => [c.choice_index, c.value])).toEqual([
        [0, 'against'],
        [1, 'for'],
      ]);
    } finally {
      await cleanup(seeded);
    }
  });

  it('findChoicesForProposals omits a proposal that declares no choices', async () => {
    const seeded = await seedTwoProposals();
    const [first, second] = seeded.proposalIds;

    await pgDb
      .insertInto('proposal_choice')
      .values([{ proposal_id: first, choice_index: 0, value: 'for' }])
      .execute();

    try {
      const out = await new ProposalReadRepository(pgDb).findChoicesForProposals(
        seeded.proposalIds,
      );

      expect(out.has(first)).toBe(true);
      expect(out.has(second)).toBe(false);
    } finally {
      await cleanup(seeded);
    }
  });
});
