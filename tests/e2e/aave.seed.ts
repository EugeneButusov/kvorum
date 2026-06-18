import { sql } from 'kysely';
import { hashApiKey } from '@libs/auth';
import {
  DelegationFlowProjectionWriter,
  VoteEventsProjectionWriter,
  ZERO_DELEGATE_ADDRESS,
  chDb,
  pgDb,
} from '@libs/db';

const TEST_PEPPER = Buffer.alloc(32, 7);
const AAVE_BEARER_KEY = `${'kv_live_'}${'z'.repeat(32)}`;

// ── Deterministic IDs (snapshot-pinned) ───────────────────────────────────────
const AAVE_USER_ID = '00000000-0000-0000-aaaa-000000000001';
const AAVE_API_KEY_ID = '00000000-0000-0000-aaaa-000000000002';
export const AAVE_DAO_ID = '00000000-0000-0000-aaaa-000000000010';
export const AAVE_PROPOSER_ACTOR_ID = '00000000-0000-0000-aaaa-000000000020';
export const AAVE_VOTER_ACTOR_ID = '00000000-0000-0000-aaaa-000000000021';
export const AAVE_DELEGATOR_ACTOR_ID = '00000000-0000-0000-aaaa-000000000022';
export const AAVE_V3_PROPOSAL_ID = '00000000-0000-0000-aaaa-000000000030';
export const AAVE_V2_PROPOSAL_ID = '00000000-0000-0000-aaaa-000000000031';
const AAVE_V3_VOTE_ID = '00000000-0000-0000-aaaa-000000000040';
const AAVE_DELEGATION_ID = '00000000-0000-0000-aaaa-000000000041';
const AAVE_UNDELEGATION_ID = '00000000-0000-0000-aaaa-000000000042';

// ── Deterministic addresses (42-char lowercase hex) ────────────────────────────
export const AAVE_PROPOSER_ADDRESS = `0x${'c0'.repeat(20)}`;
export const AAVE_VOTER_ADDRESS = `0x${'a0'.repeat(20)}`;
export const AAVE_DELEGATOR_ADDRESS = `0x${'b0'.repeat(20)}`;

// ── V3 chain geometry ──────────────────────────────────────────────────────────
export const AAVE_VOTING_CHAIN_ID = '0x89'; // Polygon voting machine
const AAVE_VM_ADDRESS = `0x${'ee'.repeat(20)}`;
const AAVE_PC_ADDRESS_MAINNET = `0x${'ff'.repeat(20)}`;
const AAVE_PC_ADDRESS_POLYGON = `0x${'fd'.repeat(20)}`;
export const AAVE_V3_SOURCE_ID = '1';
export const AAVE_V2_SOURCE_ID = '100';
const SEED_DATE = new Date('2026-01-15T12:00:00.000Z');

export type AaveSeedContext = {
  bearer: string;
  aaveDaoId: string;
  aaveV3ProposalId: string;
  aaveV2ProposalId: string;
  aaveVoterAddress: string;
  aaveDelegatorAddress: string;
  aaveV3SourceId: string;
  aaveV2SourceId: string;
};

export async function seedAaveData(): Promise<AaveSeedContext> {
  // ── source_type ───────────────────────────────────────────────────────────────
  await pgDb
    .insertInto('source_type')
    .values([
      { value: 'aave_governance_v3' },
      { value: 'aave_governor_v2' },
      { value: 'aave_voting_machine' },
      { value: 'aave_payloads_controller' },
      { value: 'aave_token' },
    ])
    .onConflict((oc) => oc.column('value').doNothing())
    .execute();

  // ── user + API key ────────────────────────────────────────────────────────────
  await pgDb
    .insertInto('users')
    .values({
      id: AAVE_USER_ID,
      email: 'aave-e2e@example.com',
      display_name: 'Aave E2E',
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
      id: AAVE_API_KEY_ID,
      user_id: AAVE_USER_ID,
      key_hash: hashApiKey(TEST_PEPPER, AAVE_BEARER_KEY),
      prefix: 'kv_live_',
      last_four: 'zzzz',
      tier: 'authenticated_free',
      label: 'aave-e2e',
      last_used_at: null,
      revoked_at: null,
      created_at: SEED_DATE,
    })
    .execute();

  // ── DAO ───────────────────────────────────────────────────────────────────────
  await pgDb
    .insertInto('dao')
    .values({
      id: AAVE_DAO_ID,
      slug: 'aave',
      name: 'Aave',
      primary_token_address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
      primary_chain_id: '1',
      description: 'Aave DAO (e2e)',
      website_url: 'https://aave.com',
      forum_url: 'https://governance.aave.com',
      created_at: SEED_DATE,
      updated_at: SEED_DATE,
    })
    .execute();

  // ── dao_source ────────────────────────────────────────────────────────────────
  await pgDb
    .insertInto('dao_source')
    .values([
      {
        dao_id: AAVE_DAO_ID,
        source_type: 'aave_governance_v3',
        chain_id: '0x1',
        source_config: { governance_address: '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7' },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
        created_at: SEED_DATE,
      },
      {
        dao_id: AAVE_DAO_ID,
        source_type: 'aave_voting_machine',
        chain_id: AAVE_VOTING_CHAIN_ID,
        source_config: { voting_machine_address: AAVE_VM_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
        created_at: SEED_DATE,
      },
      {
        dao_id: AAVE_DAO_ID,
        source_type: 'aave_governor_v2',
        chain_id: '0x1',
        source_config: { governor_address: '0xec568fffba86c094cf06b22134b23074dfe2252c' },
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
        id: AAVE_PROPOSER_ACTOR_ID,
        primary_address: AAVE_PROPOSER_ADDRESS,
        display_name: null,
        bio: null,
        profile_data: null,
        created_at: SEED_DATE,
        updated_at: SEED_DATE,
      },
      {
        id: AAVE_VOTER_ACTOR_ID,
        primary_address: AAVE_VOTER_ADDRESS,
        display_name: 'Aave Voter',
        bio: null,
        profile_data: null,
        created_at: SEED_DATE,
        updated_at: SEED_DATE,
      },
      {
        id: AAVE_DELEGATOR_ACTOR_ID,
        primary_address: AAVE_DELEGATOR_ADDRESS,
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
        actor_id: AAVE_PROPOSER_ACTOR_ID,
        address: AAVE_PROPOSER_ADDRESS,
        is_primary: true,
        source: 'm1_backfill',
      },
      {
        actor_id: AAVE_VOTER_ACTOR_ID,
        address: AAVE_VOTER_ADDRESS,
        is_primary: true,
        source: 'm1_backfill',
      },
      {
        actor_id: AAVE_DELEGATOR_ACTOR_ID,
        address: AAVE_DELEGATOR_ADDRESS,
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
        id: AAVE_V3_PROPOSAL_ID,
        dao_id: AAVE_DAO_ID,
        source_type: 'aave_governance_v3',
        source_id: AAVE_V3_SOURCE_ID,
        proposer_actor_id: AAVE_PROPOSER_ACTOR_ID,
        title: 'Aave v3 Test Proposal',
        description: 'A v3 governance proposal',
        description_hash: `0x${'11'.repeat(32)}`,
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
        id: AAVE_V2_PROPOSAL_ID,
        dao_id: AAVE_DAO_ID,
        source_type: 'aave_governor_v2',
        source_id: AAVE_V2_SOURCE_ID,
        proposer_actor_id: AAVE_PROPOSER_ACTOR_ID,
        title: 'Aave v2 Test Proposal',
        description: 'A v2 governance proposal',
        description_hash: `0x${'22'.repeat(32)}`,
        binding: true,
        voting_starts_at: new Date('2025-12-01T00:00:00.000Z'),
        voting_ends_at: new Date('2025-12-05T00:00:00.000Z'),
        voting_starts_block: '19500000',
        voting_ends_block: '19501000',
        state: 'executed',
        state_updated_at: new Date('2025-12-06T00:00:00.000Z'),
        created_at: new Date('2025-11-30T00:00:00.000Z'),
        updated_at: new Date('2025-12-06T00:00:00.000Z'),
      },
    ])
    .execute();

  // ── proposal_choice ───────────────────────────────────────────────────────────
  await pgDb
    .insertInto('proposal_choice')
    .values([
      { proposal_id: AAVE_V3_PROPOSAL_ID, choice_index: 0, value: 'Against' },
      { proposal_id: AAVE_V3_PROPOSAL_ID, choice_index: 1, value: 'For' },
      { proposal_id: AAVE_V3_PROPOSAL_ID, choice_index: 2, value: 'Abstain' },
      { proposal_id: AAVE_V2_PROPOSAL_ID, choice_index: 0, value: 'Against' },
      { proposal_id: AAVE_V2_PROPOSAL_ID, choice_index: 1, value: 'For' },
      { proposal_id: AAVE_V2_PROPOSAL_ID, choice_index: 2, value: 'Abstain' },
    ])
    .execute();

  // ── aave_proposal_metadata (v3) ───────────────────────────────────────────────
  // sql template used here: the aave_proposal_metadata table is augmented into PgDatabase
  // via @sources/aave, but importing that in app-level test files crosses a module boundary.
  // Raw SQL is explicit and correct per CLAUDE.md guidance for this case.
  await sql`
    INSERT INTO aave_proposal_metadata
      (proposal_id, voting_chain_id, voting_machine_address, voting_strategy_address, creation_block)
    VALUES
      (${AAVE_V3_PROPOSAL_ID}::uuid, ${AAVE_VOTING_CHAIN_ID}, ${AAVE_VM_ADDRESS}, NULL, 19900000::bigint)
  `.execute(pgDb);

  // ── aave_proposal_payload (2 chains: mainnet executed, polygon queued/lossy) ──
  await sql`
    INSERT INTO aave_proposal_payload
      (proposal_id, payload_index, target_chain_id, payloads_controller_address, payload_id, status, executed_at_destination)
    VALUES
      (${AAVE_V3_PROPOSAL_ID}::uuid, 0, ${'0x1'}, ${AAVE_PC_ADDRESS_MAINNET}, 42::bigint, 'executed'::aave_payload_status, ${new Date('2026-01-16T00:00:00.000Z').toISOString()}::timestamptz),
      (${AAVE_V3_PROPOSAL_ID}::uuid, 1, ${AAVE_VOTING_CHAIN_ID}, ${AAVE_PC_ADDRESS_POLYGON}, 7::bigint, 'queued'::aave_payload_status, NULL)
  `.execute(pgDb);

  // ── ClickHouse: vote_events_raw ───────────────────────────────────────────────
  // B2 INVARIANT: proposal_id here MUST equal AAVE_V3_PROPOSAL_ID from PG so that
  // alignmentWithMajorityForActor join (by proposal_id) is non-vacuous.
  const voteWriter = new VoteEventsProjectionWriter(chDb);
  await voteWriter.insertBatch([
    {
      vote_id: AAVE_V3_VOTE_ID,
      dao_id: AAVE_DAO_ID,
      proposal_id: AAVE_V3_PROPOSAL_ID,
      voter_address: AAVE_VOTER_ADDRESS,
      voting_chain_id: AAVE_VOTING_CHAIN_ID,
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
  // Aave delegation is relationship-only (ADR-0070): voting_power = '0'.
  const delegationWriter = new DelegationFlowProjectionWriter(chDb);
  await delegationWriter.insertBatch([
    {
      // Regular delegation: delegator → voter (power=0, Aave relationship-only)
      delegation_id: AAVE_DELEGATION_ID,
      dao_id: AAVE_DAO_ID,
      delegator_address: AAVE_DELEGATOR_ADDRESS,
      delegate_address: AAVE_VOTER_ADDRESS,
      voting_power: '0',
      block_number: '19800000',
      log_index: 0,
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-05T00:00:00.000Z'),
    },
    {
      // Undelegation: delegator → address(0) → API returns delegate: null
      delegation_id: AAVE_UNDELEGATION_ID,
      dao_id: AAVE_DAO_ID,
      delegator_address: AAVE_DELEGATOR_ADDRESS,
      delegate_address: ZERO_DELEGATE_ADDRESS,
      voting_power: '0',
      block_number: '19850000',
      log_index: 0,
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-10T00:00:00.000Z'),
    },
  ]);

  return {
    bearer: `Bearer ${AAVE_BEARER_KEY}`,
    aaveDaoId: AAVE_DAO_ID,
    aaveV3ProposalId: AAVE_V3_PROPOSAL_ID,
    aaveV2ProposalId: AAVE_V2_PROPOSAL_ID,
    aaveVoterAddress: AAVE_VOTER_ADDRESS,
    aaveDelegatorAddress: AAVE_DELEGATOR_ADDRESS,
    aaveV3SourceId: AAVE_V3_SOURCE_ID,
    aaveV2SourceId: AAVE_V2_SOURCE_ID,
  };
}
