import { hashApiKey } from '@libs/auth';
import { DelegationFlowProjectionWriter, VoteEventsProjectionWriter, chDb, pgDb } from '@libs/db';

const TEST_PEPPER = Buffer.alloc(32, 7);
const COMP_BEARER_KEY = `${'kv_live_'}${'c'.repeat(32)}`;

// ── Deterministic IDs (snapshot-pinned, cccc prefix avoids collisions with aave/conformance) ──
const COMP_USER_ID = '00000000-0000-0000-cccc-000000000001';
const COMP_API_KEY_ID = '00000000-0000-0000-cccc-000000000002';
export const COMP_DAO_ID = '00000000-0000-0000-cccc-000000000010';
export const COMP_PROPOSER_ACTOR_ID = '00000000-0000-0000-cccc-000000000020';
export const COMP_VOTER_ACTOR_ID = '00000000-0000-0000-cccc-000000000021';
export const COMP_DELEGATOR_ACTOR_ID = '00000000-0000-0000-cccc-000000000022';
export const COMP_BRAVO_PROPOSAL_ID = '00000000-0000-0000-cccc-000000000030';
export const COMP_OZ_PROPOSAL_ID = '00000000-0000-0000-cccc-000000000031';
const COMP_VOTE_ID = '00000000-0000-0000-cccc-000000000040';
const COMP_DELEGATION_ID = '00000000-0000-0000-cccc-000000000041';
const COMP_VOTES_CHANGED_ID = '00000000-0000-0000-cccc-000000000042';

// ── Deterministic addresses ────────────────────────────────────────────────────
export const COMP_PROPOSER_ADDRESS = `0x${'c1'.repeat(20)}`;
export const COMP_VOTER_ADDRESS = `0x${'c2'.repeat(20)}`;
export const COMP_DELEGATOR_ADDRESS = `0x${'c3'.repeat(20)}`;

// ── Source IDs ─────────────────────────────────────────────────────────────────
export const COMP_BRAVO_SOURCE_ID = '100';
export const COMP_OZ_SOURCE_ID = '1';

const SEED_DATE = new Date('2026-01-15T12:00:00.000Z');

// Real Compound governor addresses (from compound_002_seed.ts migration).
const BRAVO_GOVERNOR_ADDRESS = '0xc0da02939e1441f497fd74f78ce7decb17b66529';
const ALPHA_GOVERNOR_ADDRESS = '0xc0da01a04c3f3e0be433606045bb7017a7323e38';
const OZ_GOVERNOR_ADDRESS = '0x309a862bbc1a00e45506cb8a802d1ff10004c8c0';

export type CompoundSeedContext = {
  bearer: string;
  compDaoId: string;
  compBravoProposalId: string;
  compOzProposalId: string;
  compVoterAddress: string;
  compDelegatorAddress: string;
  compBravoSourceId: string;
  compOzSourceId: string;
};

export async function seedCompoundData(): Promise<CompoundSeedContext> {
  // ── source_type ───────────────────────────────────────────────────────────────
  await pgDb
    .insertInto('source_type')
    .values([
      { value: 'compound_governor_bravo' },
      { value: 'compound_governor_alpha' },
      { value: 'compound_governor_oz' },
      { value: 'compound_comp_token' },
    ])
    .onConflict((oc) => oc.column('value').doNothing())
    .execute();

  // ── user + API key ────────────────────────────────────────────────────────────
  await pgDb
    .insertInto('users')
    .values({
      id: COMP_USER_ID,
      email: 'compound-e2e@example.com',
      display_name: 'Compound E2E',
      role: 'admin',
      banned_at: null,
      banned_reason: null,
      created_at: SEED_DATE,
      updated_at: SEED_DATE,
    })
    .execute();

  await pgDb
    .insertInto('api_key')
    .values({
      id: COMP_API_KEY_ID,
      user_id: COMP_USER_ID,
      key_hash: hashApiKey(TEST_PEPPER, COMP_BEARER_KEY),
      prefix: 'kv_live_',
      last_four: 'cccc',
      tier: 'authenticated_free',
      label: 'compound-e2e',
      last_used_at: null,
      revoked_at: null,
      created_at: SEED_DATE,
    })
    .execute();

  // ── DAO ───────────────────────────────────────────────────────────────────────
  await pgDb
    .insertInto('dao')
    .values({
      id: COMP_DAO_ID,
      slug: 'compound',
      name: 'Compound',
      primary_token_address: '0xc00e94cb662c3520282e6f5717214004a7f26888',
      primary_chain_id: '1',
      description: 'Compound DAO (e2e)',
      website_url: 'https://compound.finance',
      forum_url: 'https://www.comp.xyz',
      created_at: SEED_DATE,
      updated_at: SEED_DATE,
    })
    .execute();

  // ── dao_source (3 governors) ──────────────────────────────────────────────────
  await pgDb
    .insertInto('dao_source')
    .values([
      {
        dao_id: COMP_DAO_ID,
        source_type: 'compound_governor_bravo',
        chain_id: '0x1',
        source_config: { governor_address: BRAVO_GOVERNOR_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
        created_at: SEED_DATE,
      },
      {
        dao_id: COMP_DAO_ID,
        source_type: 'compound_governor_alpha',
        chain_id: '0x1',
        source_config: { governor_address: ALPHA_GOVERNOR_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
        created_at: SEED_DATE,
      },
      {
        dao_id: COMP_DAO_ID,
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        source_config: { governor_address: OZ_GOVERNOR_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
        created_at: SEED_DATE,
      },
    ])
    .execute();

  // ── actors ────────────────────────────────────────────────────────────────────
  await pgDb
    .insertInto('actor')
    .values([
      {
        id: COMP_PROPOSER_ACTOR_ID,
        primary_address: COMP_PROPOSER_ADDRESS,
        display_name: null,
        bio: null,
        profile_data: null,
        created_at: SEED_DATE,
        updated_at: SEED_DATE,
      },
      {
        id: COMP_VOTER_ACTOR_ID,
        primary_address: COMP_VOTER_ADDRESS,
        display_name: 'Compound Voter',
        bio: null,
        profile_data: null,
        created_at: SEED_DATE,
        updated_at: SEED_DATE,
      },
      {
        id: COMP_DELEGATOR_ACTOR_ID,
        primary_address: COMP_DELEGATOR_ADDRESS,
        display_name: null,
        bio: null,
        profile_data: null,
        created_at: SEED_DATE,
        updated_at: SEED_DATE,
      },
    ])
    .execute();

  await pgDb
    .insertInto('actor_address')
    .values([
      {
        actor_id: COMP_PROPOSER_ACTOR_ID,
        address: COMP_PROPOSER_ADDRESS,
        is_primary: true,
        source: 'm1_backfill',
      },
      {
        actor_id: COMP_VOTER_ACTOR_ID,
        address: COMP_VOTER_ADDRESS,
        is_primary: true,
        source: 'm1_backfill',
      },
      {
        actor_id: COMP_DELEGATOR_ACTOR_ID,
        address: COMP_DELEGATOR_ADDRESS,
        is_primary: true,
        source: 'm1_backfill',
      },
    ])
    .execute();

  // ── proposals ─────────────────────────────────────────────────────────────────
  await pgDb
    .insertInto('proposal')
    .values([
      {
        id: COMP_BRAVO_PROPOSAL_ID,
        dao_id: COMP_DAO_ID,
        source_type: 'compound_governor_bravo',
        source_id: COMP_BRAVO_SOURCE_ID,
        proposer_actor_id: COMP_PROPOSER_ACTOR_ID,
        title: 'Compound Bravo Test Proposal',
        description: 'A Governor Bravo proposal',
        description_hash: `0x${'bb'.repeat(32)}`,
        binding: true,
        voting_starts_at: new Date('2026-01-10T00:00:00.000Z'),
        voting_ends_at: new Date('2026-01-14T00:00:00.000Z'),
        voting_starts_block: '19900000',
        voting_ends_block: '19901000',
        state: 'executed',
        state_updated_at: SEED_DATE,
        created_at: new Date('2026-01-09T00:00:00.000Z'),
        updated_at: SEED_DATE,
      },
      {
        id: COMP_OZ_PROPOSAL_ID,
        dao_id: COMP_DAO_ID,
        source_type: 'compound_governor_oz',
        source_id: COMP_OZ_SOURCE_ID,
        proposer_actor_id: COMP_PROPOSER_ACTOR_ID,
        title: 'Compound OZ Test Proposal',
        description: 'A Governor OZ proposal',
        description_hash: `0x${'cc'.repeat(32)}`,
        binding: true,
        voting_starts_at: new Date('2026-01-12T00:00:00.000Z'),
        voting_ends_at: new Date('2026-01-16T00:00:00.000Z'),
        voting_starts_block: '19910000',
        voting_ends_block: '19911000',
        state: 'active',
        state_updated_at: SEED_DATE,
        created_at: new Date('2026-01-11T00:00:00.000Z'),
        updated_at: SEED_DATE,
      },
    ])
    .execute();

  // ── proposal_choice ───────────────────────────────────────────────────────────
  await pgDb
    .insertInto('proposal_choice')
    .values([
      { proposal_id: COMP_BRAVO_PROPOSAL_ID, choice_index: 0, value: 'against' },
      { proposal_id: COMP_BRAVO_PROPOSAL_ID, choice_index: 1, value: 'for' },
      { proposal_id: COMP_BRAVO_PROPOSAL_ID, choice_index: 2, value: 'abstain' },
      { proposal_id: COMP_OZ_PROPOSAL_ID, choice_index: 0, value: 'against' },
      { proposal_id: COMP_OZ_PROPOSAL_ID, choice_index: 1, value: 'for' },
      { proposal_id: COMP_OZ_PROPOSAL_ID, choice_index: 2, value: 'abstain' },
    ])
    .execute();

  // ── proposal_action (Compound-specific: on-chain calldata) ────────────────────
  await pgDb
    .insertInto('proposal_action')
    .values([
      {
        id: '00000000-0000-0000-cccc-000000001001',
        proposal_id: COMP_BRAVO_PROPOSAL_ID,
        action_index: 0,
        target_address: `0x${'ca'.repeat(20)}`,
        target_chain_id: '1',
        value_wei: '0',
        function_signature: 'setCollateralFactor(address,uint256)',
        calldata: `0x${'ab'.repeat(32)}`,
        decoded_function: 'setCollateralFactor',
        decoded_arguments: {
          asset: `0x${'ca'.repeat(20)}`,
          newCollateralFactorMantissa: '750000000000000000',
        },
        created_at: SEED_DATE,
      },
    ])
    .execute();

  // ── ClickHouse: vote_events_raw ───────────────────────────────────────────────
  // Compound votes on the same chain (0x1) with non-zero voting_power.
  const voteWriter = new VoteEventsProjectionWriter(chDb);
  await voteWriter.insertBatch([
    {
      vote_id: COMP_VOTE_ID,
      dao_id: COMP_DAO_ID,
      proposal_id: COMP_BRAVO_PROPOSAL_ID,
      voter_address: COMP_VOTER_ADDRESS,
      voting_chain_id: '0x1',
      primary_choice: 1,
      voting_power: '1000000000000000000',
      cast_at: SEED_DATE,
      block_number: '19900500',
      log_index: 0,
      superseded: 0,
      superseded_at: null,
      superseded_by_vote_id: null,
    },
  ]);

  // ── ClickHouse: delegation_flow_raw ──────────────────────────────────────────
  // Compound delegation is power-bearing (comp_token emits both delegate_changed and votes_changed).
  const delegationWriter = new DelegationFlowProjectionWriter(chDb);
  await delegationWriter.insertBatch([
    {
      // Relationship event: delegator delegates to voter
      delegation_id: COMP_DELEGATION_ID,
      dao_id: COMP_DAO_ID,
      delegator_address: COMP_DELEGATOR_ADDRESS,
      delegate_address: COMP_VOTER_ADDRESS,
      voting_power: '500000000000000000',
      block_number: '19800000',
      log_index: 0,
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-05T00:00:00.000Z'),
    },
    {
      // Power event: voter's total voting power increased (votes_changed from DelegateVotesChanged).
      // delegator_address here is the delegate whose voting power changed (CH schema convention).
      delegation_id: COMP_VOTES_CHANGED_ID,
      dao_id: COMP_DAO_ID,
      delegator_address: COMP_VOTER_ADDRESS,
      delegate_address: COMP_VOTER_ADDRESS,
      voting_power: '500000000000000000',
      block_number: '19800000',
      log_index: 1,
      event_type: 'votes_changed',
      created_at: new Date('2026-01-05T00:00:00.000Z'),
    },
  ]);

  return {
    bearer: `Bearer ${COMP_BEARER_KEY}`,
    compDaoId: COMP_DAO_ID,
    compBravoProposalId: COMP_BRAVO_PROPOSAL_ID,
    compOzProposalId: COMP_OZ_PROPOSAL_ID,
    compVoterAddress: COMP_VOTER_ADDRESS,
    compDelegatorAddress: COMP_DELEGATOR_ADDRESS,
    compBravoSourceId: COMP_BRAVO_SOURCE_ID,
    compOzSourceId: COMP_OZ_SOURCE_ID,
  };
}
