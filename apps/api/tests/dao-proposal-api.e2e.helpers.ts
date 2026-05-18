import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'kysely';
import { hashApiKey } from '../../../libs/auth/src/hash';
import { pgDb } from '../../../libs/db/src/client';
import { AppModule } from '../src/app/app.module';
import { configureOpenApi } from '../src/openapi/openapi';
import { RateLimiterService } from '../src/rate-limit/rate-limiter.service';

export const describeHttpIf = process.env.NEST_HTTP_TESTS === '1' ? describe : describe.skip;

const TEST_PEPPER = Buffer.alloc(32, 7);
const TEST_PEPPER_B64 = TEST_PEPPER.toString('base64');
const TEST_BEARER_KEY = `${'kv_live_'}${'a'.repeat(32)}`;
const TEST_PRIMARY_TOKEN_ADDRESS = `0x${'c'.repeat(40)}`;
const TEST_PROPOSER_ADDRESS = `0x${'a'.repeat(40)}`;
const TEST_ACTION_TARGET_ADDRESS = `0x${'b'.repeat(40)}`;

export type SeedContext = {
  bearer: string;
  daoId: string;
  proposalId: string;
};

export async function createRealApp(): Promise<INestApplication> {
  process.env['HMAC_PEPPER_CURRENT'] = TEST_PEPPER_B64;
  process.env['REDIS_URL'] = 'redis://127.0.0.1:6379';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RateLimiterService)
    .useValue({
      consume: async () => ({
        allowed: true,
        limit: 60,
        remaining: 59,
        resetSeconds: 60,
        retryAfterSeconds: 0,
        bindingWindow: 'minute',
      }),
    })
    .compile();
  const app = moduleRef.createNestApplication();
  configureOpenApi(app);
  await app.init();
  return app;
}

export async function resetDaoProposalApiTables(): Promise<void> {
  await sql`
    TRUNCATE TABLE
      proposal_choice,
      proposal_action,
      proposal,
      dao_source,
      actor,
      dao,
      api_key,
      users
    RESTART IDENTITY CASCADE
  `.execute(pgDb);
}

export async function seedDaoProposalApiData(): Promise<SeedContext> {
  await pgDb
    .insertInto('source_type')
    .values([{ value: 'compound_governor_bravo' }, { value: 'alt_governor' }])
    .onConflict((oc) => oc.column('value').doNothing())
    .execute();

  const user = await pgDb
    .insertInto('users')
    .values({
      email: 'api-e2e@example.com',
      display_name: 'H5 E2E',
      role: 'admin',
      banned_at: null,
      banned_reason: null,
      updated_at: new Date(),
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  const key = TEST_BEARER_KEY;
  await pgDb
    .insertInto('api_key')
    .values({
      user_id: user.id,
      key_hash: hashApiKey(TEST_PEPPER, key),
      prefix: 'kv_live_',
      last_four: 'aaaa',
      tier: 'authenticated_free',
      label: 'api-e2e',
      last_used_at: null,
      revoked_at: null,
    })
    .execute();

  const dao = await pgDb
    .insertInto('dao')
    .values({
      slug: 'compound',
      name: 'Compound',
      primary_token_address: TEST_PRIMARY_TOKEN_ADDRESS,
      primary_chain_id: '1',
      description: 'Compound DAO',
      website_url: 'https://compound.finance',
      forum_url: 'https://www.comp.xyz',
      updated_at: new Date('2026-05-15T10:00:00.000Z'),
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  await pgDb
    .insertInto('dao_source')
    .values([
      {
        dao_id: dao.id,
        source_type: 'compound_governor_bravo',
        source_config: { contract_address: '0x1234', chain_id: '1', ignored: true },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      },
      {
        dao_id: dao.id,
        source_type: 'alt_governor',
        source_config: { contract_address: '0x5678', chain_id: 10 },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      },
    ])
    .execute();

  const actor = await pgDb
    .insertInto('actor')
    .values({
      primary_address: TEST_PROPOSER_ADDRESS,
      display_name: null,
      bio: null,
      profile_data: null,
      updated_at: new Date('2026-05-15T10:00:00.000Z'),
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  const proposal = await pgDb
    .insertInto('proposal')
    .values({
      dao_id: dao.id,
      source_type: 'compound_governor_bravo',
      source_id: '42',
      proposer_actor_id: actor.id,
      title: 'Test Proposal',
      description: 'Proposal body',
      description_hash: '0xdeadbeef',
      binding: true,
      voting_starts_at: new Date('2026-05-15T09:00:00.123Z'),
      voting_ends_at: null,
      voting_starts_block: null,
      voting_ends_block: null,
      voting_power_block: '19854210',
      state: 'active',
      state_updated_at: new Date('2026-05-15T11:00:00.456Z'),
      updated_at: new Date('2026-05-15T11:00:00.456Z'),
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  await pgDb
    .insertInto('proposal_action')
    .values({
      proposal_id: proposal.id,
      action_index: 0,
      target_address: TEST_ACTION_TARGET_ADDRESS,
      target_chain_id: '1',
      value_wei: '0',
      function_signature: null,
      calldata: '0x',
      decoded_function: null,
      decoded_arguments: null,
    })
    .execute();

  await pgDb
    .insertInto('proposal_choice')
    .values({ proposal_id: proposal.id, choice_index: 0, value: 'For' })
    .execute();

  return {
    bearer: `Bearer ${key}`,
    daoId: dao.id,
    proposalId: proposal.id,
  };
}
