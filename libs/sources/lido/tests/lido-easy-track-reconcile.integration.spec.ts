import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import { ActorRepository, pgDb } from '@libs/db';
import { ReconcileDriver, type ReconcileRpcClient } from '@sources/core';
import {
  EASY_TRACK_GETTERS_INTERFACE,
  EasyTrackReconcileRepository,
  EasyTrackStateReconciler,
} from '@sources/lido';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const ET_ADDRESS = '0xf0211b7660680b49de1a7e9f25c65660f0a13fea';
const CREATOR = '0x' + '11'.repeat(20);
const FACTORY = '0x' + '22'.repeat(20);

const NOOP_METRICS = {
  recordBacklog: () => undefined,
  recordBatchSaturated: () => undefined,
  recordOutcome: () => undefined,
  recordRpcFailEscalated: () => undefined,
  recordTickDurationSeconds: () => undefined,
};

// getMotions() returns motion 1 with window [1000, 1200]; the confirmed block is well past it.
function makeClient(
  motions: { id: bigint; startDate: bigint; duration: bigint }[],
  blockTs: number,
) {
  const tuples = motions.map((m) => [
    m.id,
    ET_ADDRESS,
    CREATOR,
    m.duration,
    m.startDate,
    0n,
    50n,
    0n,
    '0x' + 'ab'.repeat(32),
  ]);
  const raw = EASY_TRACK_GETTERS_INTERFACE.encodeFunctionResult('getMotions', [tuples]);
  const send = ((method: string) => {
    if (method === 'eth_call') return Promise.resolve(raw);
    if (method === 'eth_getBlockByNumber') {
      return Promise.resolve({ timestamp: '0x' + blockTs.toString(16) });
    }
    return Promise.resolve(undefined);
  }) as ReconcileRpcClient['send'];
  return { send } as ReconcileRpcClient;
}

describeIf('Lido Easy Track reconcile integration', () => {
  let daoId = '';

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'easy_track' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();
    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lido-et-recon-${Date.now()}`,
        name: 'Lido Easy Track Reconcile',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Lido Easy Track reconcile integration test',
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
        source_type: 'easy_track',
        chain_id: CHAIN_ID,
        source_config: { easy_track_address: ET_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .execute();
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE proposal, actor, actor_address, easy_track_motion_meta RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, proposal, actor, actor_address, easy_track_motion_meta RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
  });

  // Seed an `active` easy_track proposal + its motion-meta row (objection window open in the model).
  async function seedActiveMotionProposal(sourceId: string): Promise<string> {
    const creator = await new ActorRepository(pgDb).findOrCreateActorAddress(
      CREATOR,
      'proposer_event',
    );
    const proposal = await pgDb
      .insertInto('proposal')
      .values({
        dao_id: daoId,
        source_type: 'easy_track',
        source_id: sourceId,
        proposer_actor_id: creator.id,
        title: `Easy Track motion #${sourceId}`,
        description: '',
        description_hash: createHash('sha256').update('').digest('hex'),
        binding: true,
        state: 'active',
        state_updated_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await pgDb
      .insertInto('easy_track_motion_meta')
      .values({
        proposal_id: proposal.id,
        motion_id: sourceId,
        factory_address: FACTORY,
        objection_ends_at: new Date(1200 * 1000),
        state: 'active',
        last_reconcile_check_block: null,
      })
      .execute();
    return proposal.id;
  }

  function makeDriver(client: ReconcileRpcClient) {
    const repo = new EasyTrackReconcileRepository(pgDb);
    const reconciler = new EasyTrackStateReconciler(silentLogger, ['easy_track']);
    const driver = new ReconcileDriver(reconciler, repo, NOOP_METRICS, silentLogger, {
      batchSize: 50,
      rpcFailEscalateAfter: 5,
    });
    return { driver, client };
  }

  async function stateOf(proposalId: string): Promise<string> {
    const row = await pgDb
      .selectFrom('proposal')
      .select('state')
      .where('id', '=', proposalId)
      .executeTakeFirstOrThrow();
    return row.state;
  }

  it('advances active → queued for a motion past its window (event-silent optimistic pass)', async () => {
    const proposalId = await seedActiveMotionProposal('1');
    const { driver, client } = makeDriver(
      makeClient([{ id: 1n, startDate: 1000n, duration: 200n }], 5000), // window ends 1200 < blockTs 5000
    );

    await driver.onConfirmedHeads([
      { chainId: CHAIN_ID, confirmedThresholdBlock: '100', recheckGapBlocks: 10, client },
    ]);

    expect(await stateOf(proposalId)).toBe('queued');
    const meta = await pgDb
      .selectFrom('easy_track_motion_meta')
      .select(['state', 'last_reconcile_check_block'])
      .where('proposal_id', '=', proposalId)
      .executeTakeFirstOrThrow();
    expect(meta.state).toBe('active'); // motion is still active on-chain; only the proposal advances
    expect(meta.last_reconcile_check_block).toBe('100'); // watermark advanced
  }, 30_000);

  it('leaves a motion still inside its objection window active', async () => {
    const proposalId = await seedActiveMotionProposal('2');
    const { driver, client } = makeDriver(
      makeClient([{ id: 2n, startDate: 4000n, duration: 5000n }], 5000), // window ends 9000 > blockTs 5000
    );

    await driver.onConfirmedHeads([
      { chainId: CHAIN_ID, confirmedThresholdBlock: '100', recheckGapBlocks: 10, client },
    ]);

    expect(await stateOf(proposalId)).toBe('active');
  }, 30_000);
});
