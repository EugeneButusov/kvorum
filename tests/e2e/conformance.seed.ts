import { sql } from 'kysely';
import { resetDaoProposalApiTables } from '../../apps/api/tests/dao-proposal-api.e2e.helpers';
import { hashApiKey } from '../../libs/auth/src/hash';
import { pgDb } from '../../libs/db/src/client';

const TEST_PEPPER = Buffer.alloc(32, 7);
const TEST_BEARER_KEY = `${'kv_live_'}${'a'.repeat(32)}`;

export type ConformanceSeedContext = {
  bearer: string;
  proposalWithNullVotingWindowSourceId: string;
  actorPrimaryAddress: string;
};

export async function seedConformanceData(): Promise<ConformanceSeedContext> {
  await resetDaoProposalApiTables();

  await pgDb
    .insertInto('source_type')
    .values([{ value: 'compound_governor_bravo' }, { value: 'alt_governor' }])
    .onConflict((oc) => oc.column('value').doNothing())
    .execute();

  const userId = '00000000-0000-0000-0000-000000000111';
  const daoId = '00000000-0000-0000-0000-000000000222';
  const actorAId = '00000000-0000-0000-0000-000000000333';
  const actorBId = '00000000-0000-0000-0000-000000000444';
  const proposalExecutedId = '00000000-0000-0000-0000-000000000555';
  const proposalNullVotingWindowId = '00000000-0000-0000-0000-000000000666';
  const proposalPagedId = '00000000-0000-0000-0000-000000000777';

  await pgDb
    .insertInto('users')
    .values({
      id: userId,
      email: 'conformance-e2e@example.com',
      display_name: 'Conformance E2E',
      role: 'admin',
      banned_at: null,
      banned_reason: null,
      created_at: new Date('2026-05-16T09:00:00.000Z'),
      updated_at: new Date('2026-05-16T09:00:00.000Z'),
    })
    .execute();

  await pgDb
    .insertInto('api_key')
    .values({
      id: '00000000-0000-0000-0000-000000000888',
      user_id: userId,
      key_hash: hashApiKey(TEST_PEPPER, TEST_BEARER_KEY),
      prefix: 'kv_live_',
      last_four: 'aaaa',
      tier: 'authenticated_free',
      label: 'conformance-e2e',
      last_used_at: null,
      revoked_at: null,
      created_at: new Date('2026-05-16T09:00:01.000Z'),
    })
    .execute();

  await pgDb
    .insertInto('dao')
    .values({
      id: daoId,
      slug: 'compound',
      name: 'Compound',
      primary_token_address: `0x${'c'.repeat(40)}`,
      primary_chain_id: '1',
      description: 'Compound DAO',
      website_url: 'https://compound.finance',
      forum_url: 'https://www.comp.xyz',
      created_at: new Date('2026-05-16T09:01:00.000Z'),
      updated_at: new Date('2026-05-16T10:00:00.000Z'),
    })
    .execute();

  await pgDb
    .insertInto('dao_source')
    .values([
      {
        id: '00000000-0000-0000-0000-000000000999',
        dao_id: daoId,
        source_type: 'compound_governor_bravo',
        chain_id: '0x1',
        source_config: {
          contract_address: `0x${'d'.repeat(40)}`,
          chain_id: '0x1',
          ignored: true,
        },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
        created_at: new Date('2026-05-16T09:01:01.000Z'),
      },
      {
        id: '00000000-0000-0000-0000-000000001000',
        dao_id: daoId,
        source_type: 'alt_governor',
        chain_id: '0x1',
        source_config: { contract_address: `0x${'e'.repeat(40)}` },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
        created_at: new Date('2026-05-16T09:01:02.000Z'),
      },
    ])
    .execute();

  await pgDb
    .insertInto('actor')
    .values([
      {
        id: actorAId,
        primary_address: `0x${'a'.repeat(40)}`,
        display_name: null,
        bio: null,
        profile_data: null,
        created_at: new Date('2026-05-16T09:02:00.000Z'),
        updated_at: new Date('2026-05-16T09:02:00.000Z'),
      },
      {
        id: actorBId,
        primary_address: `0x${'b'.repeat(40)}`,
        display_name: 'Second Proposer',
        bio: null,
        profile_data: null,
        created_at: new Date('2026-05-16T09:02:01.000Z'),
        updated_at: new Date('2026-05-16T09:02:01.000Z'),
      },
    ])
    .execute();

  await pgDb
    .insertInto('actor_address')
    .values([
      {
        actor_id: actorAId,
        address: `0x${'a'.repeat(40)}`,
        is_primary: true,
        source: 'm1_backfill',
      },
      {
        actor_id: actorBId,
        address: `0x${'b'.repeat(40)}`,
        is_primary: true,
        source: 'm1_backfill',
      },
    ])
    .execute();

  await pgDb
    .insertInto('proposal')
    .values([
      {
        id: proposalExecutedId,
        dao_id: daoId,
        source_type: 'compound_governor_bravo',
        source_id: '42',
        proposer_actor_id: actorAId,
        title: 'Executed proposal',
        description: 'Executed proposal body',
        description_hash: `0x${'1'.repeat(64)}`,
        binding: true,
        voting_starts_at: new Date('2026-05-15T09:00:00.000Z'),
        voting_ends_at: new Date('2026-05-15T15:00:00.000Z'),
        voting_starts_block: '19850001',
        voting_ends_block: '19851001',
        state: 'executed',
        state_updated_at: new Date('2026-05-15T16:00:00.000Z'),
        created_at: new Date('2026-05-15T08:00:00.000Z'),
        updated_at: new Date('2026-05-15T16:00:00.000Z'),
      },
      {
        id: proposalNullVotingWindowId,
        dao_id: daoId,
        source_type: 'compound_governor_bravo',
        source_id: '43',
        proposer_actor_id: actorAId,
        title: null,
        description: 'Null voting window proposal',
        description_hash: `0x${'2'.repeat(64)}`,
        binding: false,
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: null,
        voting_ends_block: null,
        state: 'pending',
        state_updated_at: new Date('2026-05-15T17:00:00.000Z'),
        created_at: new Date('2026-05-15T09:00:00.000Z'),
        updated_at: new Date('2026-05-15T17:00:00.000Z'),
      },
      {
        id: proposalPagedId,
        dao_id: daoId,
        source_type: 'compound_governor_bravo',
        source_id: '44',
        proposer_actor_id: actorBId,
        title: 'Paged proposal',
        description: 'Paged proposal body',
        description_hash: `0x${'3'.repeat(64)}`,
        binding: true,
        voting_starts_at: new Date('2026-05-15T18:00:00.000Z'),
        voting_ends_at: new Date('2026-05-16T18:00:00.000Z'),
        voting_starts_block: '19852001',
        voting_ends_block: '19853001',
        state: 'active',
        state_updated_at: new Date('2026-05-15T18:30:00.000Z'),
        created_at: new Date('2026-05-15T10:00:00.000Z'),
        updated_at: new Date('2026-05-15T18:30:00.000Z'),
      },
    ])
    .execute();

  await pgDb
    .insertInto('proposal_action')
    .values([
      {
        id: '00000000-0000-0000-0000-000000001101',
        proposal_id: proposalExecutedId,
        action_index: 0,
        target_address: `0x${'f'.repeat(40)}`,
        target_chain_id: '1',
        value_wei: '0',
        function_signature: 'setParameter(uint256)',
        calldata: '0x1234',
        decoded_function: 'setParameter',
        decoded_arguments: { value: '1' },
        created_at: new Date('2026-05-15T12:00:00.000Z'),
      },
      {
        id: '00000000-0000-0000-0000-000000001102',
        proposal_id: proposalExecutedId,
        action_index: 1,
        target_address: `0x${'1'.repeat(40)}`,
        target_chain_id: '1',
        value_wei: '42',
        function_signature: null,
        calldata: '0xabcd',
        decoded_function: null,
        decoded_arguments: null,
        created_at: new Date('2026-05-15T12:00:01.000Z'),
      },
    ])
    .execute();

  await pgDb
    .insertInto('proposal_choice')
    .values([
      { proposal_id: proposalExecutedId, choice_index: 0, value: 'Against' },
      { proposal_id: proposalExecutedId, choice_index: 1, value: 'For' },
      { proposal_id: proposalExecutedId, choice_index: 2, value: 'Abstain' },
      { proposal_id: proposalNullVotingWindowId, choice_index: 0, value: 'Against' },
      { proposal_id: proposalNullVotingWindowId, choice_index: 1, value: 'For' },
      { proposal_id: proposalNullVotingWindowId, choice_index: 2, value: 'Abstain' },
      { proposal_id: proposalPagedId, choice_index: 0, value: 'Against' },
      { proposal_id: proposalPagedId, choice_index: 1, value: 'For' },
      { proposal_id: proposalPagedId, choice_index: 2, value: 'Abstain' },
    ])
    .execute();

  await sql`select 1`.execute(pgDb);

  return {
    bearer: `Bearer ${TEST_BEARER_KEY}`,
    proposalWithNullVotingWindowSourceId: '43',
    actorPrimaryAddress: `0x${'a'.repeat(40)}`,
  };
}
