import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import { ProposalRepository, pgDb } from '@libs/db';
import { AragonProposalRepository, AragonStateReconciler, GET_VOTE_INTERFACE } from '@sources/lido';

const DB_URL = process.env['DATABASE_URL'];
const describeIf = DB_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const VOTING = '0x2e59a20f205bb85a89c53f1936454680651e618e';
// 1-call spec-1 CallsScript: spec id + to(20) + len(4=00000004) + calldata(0xaabbccdd)
const SCRIPT = '0x00000001' + '11'.repeat(20) + '00000004' + 'aabbccdd';

function getVoteHex(o: {
  open: boolean;
  executed: boolean;
  yea: bigint;
  nay: bigint;
  votingPower: bigint;
}): string {
  return GET_VOTE_INTERFACE.encodeFunctionResult('getVote', [
    o.open,
    o.executed,
    1_700_000_000n,
    18_000_000n,
    500_000_000_000_000_000n,
    50_000_000_000_000_000n,
    o.yea,
    o.nay,
    o.votingPower,
    SCRIPT,
    o.open ? 0 : 2,
  ]);
}

function makeChainCtx(getVote: string) {
  return {
    client: {
      send: vi.fn(async (method: string) => {
        if (method === 'eth_call') return getVote;
        if (method === 'eth_getBlockByNumber') return { timestamp: '0x655d8d80' };
        throw new Error(`unexpected ${method}`);
      }),
    },
    chainCfg: { chainId: CHAIN_ID },
  };
}

describeIf('Lido Aragon reconcile integration', () => {
  let daoId = '';
  let proposerActorId = '';
  const aragonProposals = new AragonProposalRepository(pgDb);
  const proposals = new ProposalRepository(pgDb);
  const reconciler = new AragonStateReconciler(silentLogger, ['aragon_voting'], proposals);
  const bounds = [
    { chainId: CHAIN_ID, confirmedThresholdBlock: '18500000', recheckGapBlocks: 600 },
  ];

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'aragon_voting' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lido-aragon-reconcile-${Date.now()}`,
        name: 'Lido Aragon Reconcile Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'reconcile integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoId = dao.id;

    await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: 'aragon_voting',
        chain_id: CHAIN_ID,
        source_config: { voting_address: VOTING },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .execute();

    const actor = await pgDb
      .insertInto('actor')
      .values({ primary_address: '0x' + 'ab'.repeat(20), updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    proposerActorId = actor.id;
  }, 30_000);

  afterAll(async () => {
    await sql`TRUNCATE dao, actor RESTART IDENTITY CASCADE`.execute(pgDb);
  });

  beforeEach(async () => {
    await sql`DELETE FROM proposal WHERE dao_id = ${daoId}`.execute(pgDb);
  });

  async function seedActiveProposal(sourceId: string): Promise<string> {
    const proposal = await pgDb
      .insertInto('proposal')
      .values({
        dao_id: daoId,
        source_type: 'aragon_voting',
        source_id: sourceId,
        proposer_actor_id: proposerActorId,
        title: 'Vote',
        description: 'x',
        description_hash: 'h',
        binding: true,
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '18000000',
        voting_ends_block: null,
        state: 'active',
        state_updated_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await pgDb
      .insertInto('aragon_proposal_metadata')
      .values({
        proposal_id: proposal.id,
        app_address: VOTING,
        app_version: null,
        support_required_pct: null,
        min_accept_quorum_pct: null,
        main_phase_ends_at: null,
        objection_phase_ends_at: null,
        executed_at: null,
        last_reconcile_check_block: null,
      })
      .execute();
    return proposal.id;
  }

  it('candidate query returns a pct-NULL proposal, then excludes it once enriched + terminal', async () => {
    const id = await seedActiveProposal('170');

    const before = await aragonProposals.findStaleForReconciliation(['aragon_voting'], bounds, 50);
    expect(before.map((r) => r.id)).toContain(id);

    // simulate a completed reconcile: fill pct + mark checked + move terminal
    await aragonProposals.fillSupportQuorum(id, {
      supportRequiredPct: '5',
      minAcceptQuorumPct: '1',
    });
    await aragonProposals.reconcileState({
      proposalId: id,
      expectedStates: ['active'],
      targetState: 'defeated',
      stateUpdatedAt: new Date(),
    });
    await aragonProposals.markReconcileChecked(id, '18500000');

    const after = await aragonProposals.findStaleForReconciliation(['aragon_voting'], bounds, 50);
    expect(after.map((r) => r.id)).not.toContain(id);
  }, 30_000);

  it('reconciles a closed passing vote → succeeded, inserts actions, fills pct, advances watermark', async () => {
    const id = await seedActiveProposal('171');
    const [row] = await aragonProposals.findStaleForReconciliation(['aragon_voting'], bounds, 50);

    const outcome = await reconciler.reconcileRow({
      row: row!,
      proposals: aragonProposals,
      confirmedThreshold: 18_500_000n,
      confirmedThresholdTag: '0x11a52a0',
      chainCtx: makeChainCtx(
        getVoteHex({ open: false, executed: false, yea: 700n, nay: 100n, votingPower: 1000n }),
      ) as never,
    });

    expect(outcome).toMatchObject({ outcome: 'corrected', toState: 'succeeded' });

    const proposal = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(proposal.state).toBe('succeeded');

    const meta = await pgDb
      .selectFrom('aragon_proposal_metadata')
      .selectAll()
      .where('proposal_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(meta.support_required_pct).toBe('500000000000000000');
    expect(meta.min_accept_quorum_pct).toBe('50000000000000000');
    expect(meta.last_reconcile_check_block).toBe('18500000');

    const actions = await pgDb
      .selectFrom('proposal_action')
      .selectAll()
      .where('proposal_id', '=', id)
      .execute();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.target_address).toBe('0x' + '11'.repeat(20));
  }, 30_000);

  it('surfaces missed_event (no state write) when getVote reports executed', async () => {
    const id = await seedActiveProposal('172');
    // pre-fill pct so this row is selected only via state='active', and enrich is skipped
    await aragonProposals.fillSupportQuorum(id, {
      supportRequiredPct: '5',
      minAcceptQuorumPct: '1',
    });
    const [row] = await aragonProposals.findStaleForReconciliation(['aragon_voting'], bounds, 50);

    const outcome = await reconciler.reconcileRow({
      row: row!,
      proposals: aragonProposals,
      confirmedThreshold: 18_500_000n,
      confirmedThresholdTag: '0x11a52a0',
      chainCtx: makeChainCtx(
        getVoteHex({ open: false, executed: true, yea: 700n, nay: 100n, votingPower: 1000n }),
      ) as never,
    });

    expect(outcome).toEqual({ outcome: 'missed_event' });
    const proposal = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(proposal.state).toBe('active');
  }, 30_000);
});
