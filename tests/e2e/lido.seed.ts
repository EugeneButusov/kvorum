import { sql } from 'kysely';
import { hashApiKey } from '@libs/auth';
import { VoteEventsProjectionWriter, chDb, pgDb } from '@libs/db';

// A Lido DAO seed exercising all four governance tracks (Aragon binding, Dual Governance, Easy
// Track, Snapshot signaling) plus off-chain Snapshot delegation and a linked forum thread. Mirrors
// aave.seed / compound.seed. Extension tables (owned by @sources/*) are inserted via raw sql to
// avoid crossing the source-lib module boundary from an app-level test file (per aave.seed).

const TEST_PEPPER = Buffer.alloc(32, 7);
const LIDO_BEARER_KEY = `${'kv_live_'}${'y'.repeat(32)}`;

const LIDO_USER_ID = '00000000-0000-0000-bbbb-000000000001';
const LIDO_API_KEY_ID = '00000000-0000-0000-bbbb-000000000002';
export const LIDO_DAO_ID = '00000000-0000-0000-bbbb-000000000010';
export const LIDO_PROPOSER_ACTOR_ID = '00000000-0000-0000-bbbb-000000000020';
export const LIDO_VOTER_ACTOR_ID = '00000000-0000-0000-bbbb-000000000021';
export const LIDO_DELEGATOR_ACTOR_ID = '00000000-0000-0000-bbbb-000000000022';

export const LIDO_ARAGON_PROPOSAL_ID = '00000000-0000-0000-bbbb-000000000030';
export const LIDO_SNAPSHOT_PROPOSAL_ID = '00000000-0000-0000-bbbb-000000000031';
export const LIDO_EASYTRACK_PROPOSAL_ID = '00000000-0000-0000-bbbb-000000000032';
export const LIDO_DG_PROPOSAL_ID = '00000000-0000-0000-bbbb-000000000033';
const LIDO_ARAGON_VOTE_ID = '00000000-0000-0000-bbbb-000000000040';
const LIDO_SNAPSHOT_VOTE_ID = '00000000-0000-0000-bbbb-000000000041';
const LIDO_FORUM_THREAD_ID = '00000000-0000-0000-bbbb-000000000050';

export const LIDO_PROPOSER_ADDRESS = `0x${'c1'.repeat(20)}`;
export const LIDO_VOTER_ADDRESS = `0x${'a1'.repeat(20)}`;
export const LIDO_DELEGATOR_ADDRESS = `0x${'b1'.repeat(20)}`;
export const LIDO_DELEGATE_ADDRESS = `0x${'d1'.repeat(20)}`;

// Source ids: Aragon voteId, Snapshot proposal hash, Easy Track motion id, DG proposal id.
export const LIDO_ARAGON_SOURCE_ID = '77';
export const LIDO_SNAPSHOT_SOURCE_ID = `0x${'5a'.repeat(32)}`;
export const LIDO_EASYTRACK_SOURCE_ID = '5';
export const LIDO_DG_SOURCE_ID = '10';
export const LIDO_SNAPSHOT_SPACE = 'lido-snapshot.eth';
const SEED_DATE = new Date('2026-02-15T12:00:00.000Z');

export type LidoSeedContext = {
  bearer: string;
  lidoDaoId: string;
  aragonProposalId: string;
  snapshotProposalId: string;
  easyTrackProposalId: string;
  dgProposalId: string;
  voterAddress: string;
  delegatorAddress: string;
  delegateAddress: string;
};

export async function seedLidoData(): Promise<LidoSeedContext> {
  await pgDb
    .insertInto('source_type')
    .values([
      { value: 'aragon_voting' },
      { value: 'dual_governance' },
      { value: 'easy_track' },
      { value: 'snapshot' },
      { value: 'discourse_forum' },
    ])
    .onConflict((oc) => oc.column('value').doNothing())
    .execute();

  await pgDb
    .insertInto('users')
    .values({
      id: LIDO_USER_ID,
      email: 'lido-e2e@example.com',
      display_name: 'Lido E2E',
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
      id: LIDO_API_KEY_ID,
      user_id: LIDO_USER_ID,
      key_hash: hashApiKey(TEST_PEPPER, LIDO_BEARER_KEY),
      prefix: 'kv_live_',
      last_four: 'yyyy',
      tier: 'authenticated_free',
      label: 'lido-e2e',
      last_used_at: null,
      revoked_at: null,
      created_at: SEED_DATE,
    })
    .execute();

  await pgDb
    .insertInto('dao')
    .values({
      id: LIDO_DAO_ID,
      slug: 'lido',
      name: 'Lido',
      primary_token_address: `0x${'5a'.repeat(20)}`,
      primary_chain_id: '1',
      description: 'Lido DAO (e2e)',
      website_url: 'https://lido.fi',
      forum_url: 'https://research.lido.fi',
      created_at: SEED_DATE,
      updated_at: SEED_DATE,
    })
    .execute();

  await pgDb
    .insertInto('dao_source')
    .values([
      {
        dao_id: LIDO_DAO_ID,
        source_type: 'aragon_voting',
        chain_id: '0x1',
        source_config: { contract_address: `0x${'2e'.repeat(20)}` },
        created_at: SEED_DATE,
      },
      {
        dao_id: LIDO_DAO_ID,
        source_type: 'dual_governance',
        chain_id: '0x1',
        source_config: { contract_address: `0xc1${'db'.repeat(19)}` },
        created_at: SEED_DATE,
      },
      {
        dao_id: LIDO_DAO_ID,
        source_type: 'easy_track',
        chain_id: '0x1',
        source_config: { contract_address: `0xf0${'ea'.repeat(19)}` },
        created_at: SEED_DATE,
      },
      {
        dao_id: LIDO_DAO_ID,
        source_type: 'snapshot',
        chain_id: '0x1',
        source_config: { space: LIDO_SNAPSHOT_SPACE },
        created_at: SEED_DATE,
      },
    ])
    .execute();

  await pgDb
    .insertInto('actor')
    .values([
      {
        id: LIDO_PROPOSER_ACTOR_ID,
        primary_address: LIDO_PROPOSER_ADDRESS,
        display_name: null,
        bio: null,
        profile_data: null,
        created_at: SEED_DATE,
        updated_at: SEED_DATE,
      },
      {
        id: LIDO_VOTER_ACTOR_ID,
        primary_address: LIDO_VOTER_ADDRESS,
        display_name: 'Lido Voter',
        bio: null,
        profile_data: null,
        created_at: SEED_DATE,
        updated_at: SEED_DATE,
      },
      {
        id: LIDO_DELEGATOR_ACTOR_ID,
        primary_address: LIDO_DELEGATOR_ADDRESS,
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
        actor_id: LIDO_PROPOSER_ACTOR_ID,
        address: LIDO_PROPOSER_ADDRESS,
        is_primary: true,
        source: 'm1_backfill',
      },
      {
        actor_id: LIDO_VOTER_ACTOR_ID,
        address: LIDO_VOTER_ADDRESS,
        is_primary: true,
        source: 'm1_backfill',
      },
      {
        actor_id: LIDO_DELEGATOR_ACTOR_ID,
        address: LIDO_DELEGATOR_ADDRESS,
        is_primary: true,
        source: 'm1_backfill',
      },
    ])
    .execute();

  // ── proposals: one per track, with terminal states for pass-rate variety ──────
  await pgDb
    .insertInto('proposal')
    .values([
      {
        id: LIDO_ARAGON_PROPOSAL_ID,
        dao_id: LIDO_DAO_ID,
        source_type: 'aragon_voting',
        source_id: LIDO_ARAGON_SOURCE_ID,
        proposer_actor_id: LIDO_PROPOSER_ACTOR_ID,
        title: 'Lido Aragon Binding Vote',
        description: 'A binding LDO governance vote',
        description_hash: `0x${'a1'.repeat(32)}`,
        binding: true,
        voting_starts_at: new Date('2026-02-10T00:00:00.000Z'),
        voting_ends_at: new Date('2026-02-14T00:00:00.000Z'),
        voting_starts_block: '21000000',
        voting_ends_block: '21001000',
        state: 'executed',
        state_updated_at: SEED_DATE,
        created_at: new Date('2026-02-09T00:00:00.000Z'),
        updated_at: SEED_DATE,
      },
      {
        id: LIDO_SNAPSHOT_PROPOSAL_ID,
        dao_id: LIDO_DAO_ID,
        source_type: 'snapshot',
        source_id: LIDO_SNAPSHOT_SOURCE_ID,
        proposer_actor_id: LIDO_PROPOSER_ACTOR_ID,
        title: 'Lido Snapshot Signaling',
        description: 'A weighted Snapshot signaling proposal',
        description_hash: `0x${'b2'.repeat(32)}`,
        binding: false,
        voting_starts_at: new Date('2026-02-01T00:00:00.000Z'),
        voting_ends_at: new Date('2026-02-05T00:00:00.000Z'),
        voting_starts_block: null,
        voting_ends_block: null,
        state: 'executed',
        state_updated_at: new Date('2026-02-06T00:00:00.000Z'),
        created_at: new Date('2026-01-31T00:00:00.000Z'),
        updated_at: new Date('2026-02-06T00:00:00.000Z'),
      },
      {
        id: LIDO_EASYTRACK_PROPOSAL_ID,
        dao_id: LIDO_DAO_ID,
        source_type: 'easy_track',
        source_id: LIDO_EASYTRACK_SOURCE_ID,
        proposer_actor_id: LIDO_PROPOSER_ACTOR_ID,
        title: 'Lido Easy Track Motion',
        description: 'An optimistic Easy Track motion',
        description_hash: `0x${'c3'.repeat(32)}`,
        binding: true,
        voting_starts_at: new Date('2026-02-08T00:00:00.000Z'),
        voting_ends_at: new Date('2026-02-11T00:00:00.000Z'),
        voting_starts_block: '21000500',
        voting_ends_block: '21000900',
        state: 'executed',
        state_updated_at: SEED_DATE,
        created_at: new Date('2026-02-08T00:00:00.000Z'),
        updated_at: SEED_DATE,
      },
      {
        id: LIDO_DG_PROPOSAL_ID,
        dao_id: LIDO_DAO_ID,
        source_type: 'dual_governance',
        source_id: LIDO_DG_SOURCE_ID,
        proposer_actor_id: LIDO_PROPOSER_ACTOR_ID,
        title: 'Lido Dual Governance Proposal',
        description: 'A DG-submitted proposal',
        description_hash: `0x${'d4'.repeat(32)}`,
        binding: true,
        voting_starts_at: new Date('2026-02-12T00:00:00.000Z'),
        voting_ends_at: new Date('2026-02-16T00:00:00.000Z'),
        voting_starts_block: '21002000',
        voting_ends_block: '21003000',
        state: 'defeated',
        state_updated_at: SEED_DATE,
        created_at: new Date('2026-02-11T00:00:00.000Z'),
        updated_at: SEED_DATE,
      },
    ])
    .execute();

  await pgDb
    .insertInto('proposal_choice')
    .values([
      { proposal_id: LIDO_ARAGON_PROPOSAL_ID, choice_index: 0, value: 'Nay' },
      { proposal_id: LIDO_ARAGON_PROPOSAL_ID, choice_index: 1, value: 'Yea' },
      { proposal_id: LIDO_SNAPSHOT_PROPOSAL_ID, choice_index: 0, value: 'Option A' },
      { proposal_id: LIDO_SNAPSHOT_PROPOSAL_ID, choice_index: 1, value: 'Option B' },
      { proposal_id: LIDO_SNAPSHOT_PROPOSAL_ID, choice_index: 2, value: 'Option C' },
    ])
    .execute();

  // ── extension metadata (raw sql; source-lib-owned tables) ─────────────────────
  await sql`
    INSERT INTO aragon_proposal_metadata
      (proposal_id, app_address, app_version, support_required_pct, min_accept_quorum_pct, executed_at)
    VALUES
      (${LIDO_ARAGON_PROPOSAL_ID}::uuid, ${`0x${'2e'.repeat(20)}`}, '4', '500000000000000000', '50000000000000000',
       ${new Date('2026-02-15T00:00:00.000Z').toISOString()}::timestamptz)
  `.execute(pgDb);

  await sql`
    INSERT INTO snapshot_proposal_metadata
      (proposal_id, space_id, voting_type, strategies, ipfs_hash, network, scores_state, flagged)
    VALUES
      (${LIDO_SNAPSHOT_PROPOSAL_ID}::uuid, ${LIDO_SNAPSHOT_SPACE}, 'weighted',
       ${JSON.stringify([{ name: 'erc20-balance-of' }])}::jsonb, 'Qm123', '0x1', 'final', false)
  `.execute(pgDb);

  await sql`
    INSERT INTO easy_track_motion_meta
      (proposal_id, motion_id, factory_address, objection_ends_at, state)
    VALUES
      (${LIDO_EASYTRACK_PROPOSAL_ID}::uuid, ${LIDO_EASYTRACK_SOURCE_ID}, ${`0x${'f0'.repeat(20)}`},
       ${new Date('2026-02-11T00:00:00.000Z').toISOString()}::timestamptz, 'enacted')
  `.execute(pgDb);

  await sql`
    INSERT INTO dual_governance_proposal
      (dao_id, dg_proposal_id, proposal_id, origin, executor, calls_hash, submitted_tx_hash, submitted_block, submitted_at, status)
    VALUES
      (${LIDO_DAO_ID}::uuid, ${LIDO_DG_SOURCE_ID}, ${LIDO_DG_PROPOSAL_ID}::uuid, 'direct',
       ${`0xce${'04'.repeat(19)}`}, ${`0x${'e5'.repeat(32)}`}, ${`0x${'f6'.repeat(32)}`}, '21002000',
       ${new Date('2026-02-11T00:00:00.000Z').toISOString()}::timestamptz, 'submitted')
  `.execute(pgDb);

  // ── snapshot_delegation (raw sql): delegator → delegate, Delegate Registry, Lido space ─
  await sql`
    INSERT INTO snapshot_delegation
      (dao_id, delegator_address, delegate_address, space_id, network, delegation_system, weight, expires_at, event_type, block_number, log_index, tx_hash, created_at)
    VALUES
      (${LIDO_DAO_ID}::uuid, ${LIDO_DELEGATOR_ADDRESS}, ${LIDO_DELEGATE_ADDRESS}, ${LIDO_SNAPSHOT_SPACE},
       '0x1', 'delegate_registry', NULL, NULL, 'set', '21000100', 0, ${`0x${'ab'.repeat(32)}`},
       ${new Date('2026-02-07T00:00:00.000Z').toISOString()}::timestamptz)
  `.execute(pgDb);

  // ── forum thread + link (raw sql): high-confidence link to the Aragon proposal ─
  await sql`
    INSERT INTO forum_thread
      (id, dao_id, forum_host, forum_topic_id, title, raw_content, content_pipeline_version, post_count, last_activity_at)
    VALUES
      (${LIDO_FORUM_THREAD_ID}::uuid, ${LIDO_DAO_ID}::uuid, 'research.lido.fi', '4242', 'Discussion: Binding Vote',
       '# Discussion', 'v1', 12, ${new Date('2026-02-13T00:00:00.000Z').toISOString()}::timestamptz)
  `.execute(pgDb);

  await sql`
    INSERT INTO proposal_forum_link
      (proposal_id, forum_thread_id, confidence, link_method)
    VALUES
      (${LIDO_ARAGON_PROPOSAL_ID}::uuid, ${LIDO_FORUM_THREAD_ID}::uuid, 'high', 'description_url')
  `.execute(pgDb);

  // ── ClickHouse: vote_events (Aragon LDO-stake power + Snapshot reported power) ─
  const voteWriter = new VoteEventsProjectionWriter(chDb);
  await voteWriter.insertBatch([
    {
      vote_id: LIDO_ARAGON_VOTE_ID,
      dao_id: LIDO_DAO_ID,
      proposal_id: LIDO_ARAGON_PROPOSAL_ID,
      voter_address: LIDO_VOTER_ADDRESS,
      voting_chain_id: '0x1',
      primary_choice: 1,
      voting_power: '5000000000000000000',
      cast_at: new Date('2026-02-12T00:00:00.000Z'),
      block_number: '21000500',
      log_index: 0,
      superseded: 0,
      superseded_at: null,
      superseded_by_vote_id: null,
    },
    {
      vote_id: LIDO_SNAPSHOT_VOTE_ID,
      dao_id: LIDO_DAO_ID,
      proposal_id: LIDO_SNAPSHOT_PROPOSAL_ID,
      voter_address: LIDO_VOTER_ADDRESS,
      voting_chain_id: '0x1',
      primary_choice: 1,
      voting_power: '3000000000000000000',
      cast_at: new Date('2026-02-03T00:00:00.000Z'),
      block_number: '0',
      log_index: 0,
      superseded: 0,
      superseded_at: null,
      superseded_by_vote_id: null,
    },
  ]);

  // ── ClickHouse: snapshot_vote_choice (weighted breakdown for the Snapshot vote) ─
  await sql`
    INSERT INTO snapshot_vote_choice (vote_id, choices, vp, vp_by_strategy)
    VALUES (
      ${LIDO_SNAPSHOT_VOTE_ID},
      ${JSON.stringify([
        { choice_index: 1, weight: '0.6' },
        { choice_index: 2, weight: '0.4' },
      ])},
      '3',
      ${JSON.stringify(['3'])}
    )
  `.execute(chDb);

  return {
    bearer: `Bearer ${LIDO_BEARER_KEY}`,
    lidoDaoId: LIDO_DAO_ID,
    aragonProposalId: LIDO_ARAGON_PROPOSAL_ID,
    snapshotProposalId: LIDO_SNAPSHOT_PROPOSAL_ID,
    easyTrackProposalId: LIDO_EASYTRACK_PROPOSAL_ID,
    dgProposalId: LIDO_DG_PROPOSAL_ID,
    voterAddress: LIDO_VOTER_ADDRESS,
    delegatorAddress: LIDO_DELEGATOR_ADDRESS,
    delegateAddress: LIDO_DELEGATE_ADDRESS,
  };
}
