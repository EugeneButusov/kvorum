import request from 'supertest';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
} from './dao-proposal-api.e2e.helpers';
import { hashApiKey } from '../../../libs/auth/src/hash';
import { pgDb } from '../../../libs/db/src/client';

const TEST_PEPPER = Buffer.alloc(32, 7);
const TEST_KEY = `${'kv_live_'}${'a'.repeat(32)}`;

function mkAddress(seed: string): string {
  return `0x${seed.repeat(40).slice(0, 40)}`;
}

async function seedAuth() {
  await pgDb
    .insertInto('users')
    .values({
      id: '10000000-0000-0000-0000-000000000001',
      email: 'actors-routing-e2e@example.com',
      display_name: 'Actors Routing E2E',
      role: 'admin',
      updated_at: new Date(),
    })
    .execute();

  await pgDb
    .insertInto('api_key')
    .values({
      id: '10000000-0000-0000-0000-000000000002',
      user_id: '10000000-0000-0000-0000-000000000001',
      key_hash: hashApiKey(TEST_PEPPER, TEST_KEY),
      prefix: 'kv_live_',
      last_four: 'aaaa',
      tier: 'authenticated_free',
      label: 'actors-routing-e2e',
    })
    .execute();

  await pgDb
    .insertInto('source_type')
    .values([{ value: 'compound_governor_bravo' }])
    .onConflict((oc) => oc.column('value').doNothing())
    .execute();

  const dao = await pgDb
    .insertInto('dao')
    .values({
      slug: 'compound',
      name: 'Compound',
      primary_token_address: `0x${'1'.repeat(40)}`,
      primary_chain_id: '1',
      description: 'Compound DAO',
      website_url: 'https://compound.finance',
      forum_url: 'https://www.comp.xyz',
      updated_at: new Date(),
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  const actorB = await pgDb
    .insertInto('actor')
    .values({
      primary_address: mkAddress('b'),
      updated_at: new Date(),
    })
    .returning(['id', 'primary_address'])
    .executeTakeFirstOrThrow();

  await pgDb
    .insertInto('actor_address')
    .values({
      actor_id: actorB.id,
      address: actorB.primary_address,
      is_primary: true,
      source: 'm1_backfill',
    })
    .execute();

  await pgDb
    .insertInto('proposal')
    .values({
      dao_id: dao.id,
      source_type: 'compound_governor_bravo',
      source_id: '42',
      proposer_actor_id: actorB.id,
      description: 'Proposal for actor route tests',
      description_hash: `0x${'2'.repeat(64)}`,
      binding: true,
      voting_starts_at: new Date('2026-05-20T00:00:00Z'),
      voting_ends_at: null,
      voting_starts_block: '1',
      voting_ends_block: '2',
      voting_power_block: '1',
      state: 'active',
      state_updated_at: new Date('2026-05-20T00:00:00Z'),
      updated_at: new Date('2026-05-20T00:00:00Z'),
    })
    .execute();

  return {
    bearer: `Bearer ${TEST_KEY}`,
    actorB,
  };
}

describeHttpIf('actors address routing e2e', () => {
  it('step-2 redirect row routes merged address to canonical base/votes/proposals URLs', async () => {
    await resetDaoProposalApiTables();
    const seeded = await seedAuth();

    const actorA = await pgDb
      .insertInto('actor')
      .values({
        primary_address: mkAddress('a'),
        merged_into_actor_id: seeded.actorB.id,
        updated_at: new Date(),
      })
      .returning(['primary_address'])
      .executeTakeFirstOrThrow();

    await pgDb
      .insertInto('actor_address')
      .values([
        {
          actor_id: seeded.actorB.id,
          address: actorA.primary_address,
          is_primary: false,
          source: 'm1_backfill',
        },
      ])
      .execute();

    await pgDb
      .insertInto('actor_address_redirect')
      .values({
        from_address: actorA.primary_address,
        to_actor_id: seeded.actorB.id,
        merged_at: new Date(),
        merge_reason: 'test',
        created_by: 'actors-routing-e2e',
      })
      .execute();

    const app = await createRealApp();
    try {
      const server = app.getHttpServer();

      await request(server)
        .get(`/v1/actors/${actorA.primary_address}`)
        .set('Authorization', seeded.bearer)
        .expect(301)
        .expect('Location', `/v1/actors/${seeded.actorB.primary_address}`);

      await request(server)
        .get(`/v1/actors/${actorA.primary_address}/votes`)
        .set('Authorization', seeded.bearer)
        .expect(301)
        .expect('Location', `/v1/actors/${seeded.actorB.primary_address}/votes`);

      await request(server)
        .get(`/v1/actors/${actorA.primary_address}/proposals`)
        .set('Authorization', seeded.bearer)
        .expect(301)
        .expect('Location', `/v1/actors/${seeded.actorB.primary_address}/proposals`);

      const canonical = await request(server)
        .get(`/v1/actors/${seeded.actorB.primary_address}`)
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(canonical.body.data.all_addresses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ address: actorA.primary_address }),
          expect.objectContaining({ address: seeded.actorB.primary_address }),
        ]),
      );
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('step-3 non-primary actor_address redirects even without redirect row', async () => {
    await resetDaoProposalApiTables();
    const seeded = await seedAuth();

    const alias = mkAddress('c');
    await pgDb
      .insertInto('actor_address')
      .values({
        actor_id: seeded.actorB.id,
        address: alias,
        is_primary: false,
        source: 'm1_backfill',
      })
      .execute();

    const app = await createRealApp();
    try {
      const server = app.getHttpServer();
      await request(server)
        .get(`/v1/actors/${alias}`)
        .set('Authorization', seeded.bearer)
        .expect(301)
        .expect('Location', `/v1/actors/${seeded.actorB.primary_address}`);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });
});
