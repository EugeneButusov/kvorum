import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import { chDb, ArchiveEventRepository, DlqRepository, pgDb } from '@libs/db';
import {
  AragonVotingEventRepository,
  LidoAragonVotingArchiveWriter,
  makeAragonVotingIngesterListener,
  ARAGON_VOTING_INTERFACE,
} from '@sources/lido';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const VOTING_ADDRESS = '0x2e59a20f205bb85a89c53f1936454680651e618e';

function encodeLog(eventName: string, args: unknown[]) {
  const fragment = ARAGON_VOTING_INTERFACE.getEvent(eventName)!;
  const encoded = ARAGON_VOTING_INTERFACE.encodeEventLog(fragment, args);
  return { topics: encoded.topics as string[], data: encoded.data };
}

describeIf('Lido Aragon Voting ingestion integration', () => {
  let daoSourceId = '';
  let listener: ReturnType<typeof makeAragonVotingIngesterListener>;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'aragon_voting' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lido-aragon-int-${Date.now()}`,
        name: 'Lido Aragon Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Lido Aragon Voting ingestion integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const source = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: dao.id,
        source_type: 'aragon_voting',
        chain_id: CHAIN_ID,
        source_config: { voting_address: VOTING_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    const archiveWriter = new LidoAragonVotingArchiveWriter({
      eventRepo: new AragonVotingEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });

    listener = makeAragonVotingIngesterListener({
      archiveWriter,
      context: {
        daoSourceId,
        sourceType: 'aragon_voting',
        chainId: CHAIN_ID,
        sourceLabel: 'aragon_voting',
      },
      logger: silentLogger,
      dlqRepo: new DlqRepository(pgDb),
    });
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_aragon_voting DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_aragon_voting DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  // Era 1 fixture: StartVote (present from genesis, no objection phase)
  it('archives StartVote (Era 1 event) into CH and PG', async () => {
    const { topics, data } = encodeLog('StartVote', [
      1n,
      '0x1111111111111111111111111111111111111111',
      'Omnibus vote #1: Enable stETH withdrawals',
    ]);
    const txHash = '0x' + '1a'.repeat(32);

    await listener([
      {
        sourceType: 'aragon_voting',
        chainId: CHAIN_ID,
        blockNumber: 11_500_000n,
        blockHash: '0x' + 'b1'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 0,
        address: VOTING_ADDRESS,
        topics,
        data,
      },
    ]);

    const pgRows = await pgDb
      .selectFrom('archive_event')
      .select(['source_type', 'chain_id', 'tx_hash', 'log_index', 'event_type', 'derived_at'])
      .where('source_type', '=', 'aragon_voting')
      .where('chain_id', '=', CHAIN_ID)
      .execute();

    expect(pgRows).toHaveLength(1);
    expect(pgRows[0]).toMatchObject({
      source_type: 'aragon_voting',
      chain_id: CHAIN_ID,
      tx_hash: txHash,
      log_index: 0,
      event_type: 'StartVote',
      derived_at: null,
    });

    const chRows = await chDb
      .selectFrom('archive_event_aragon_voting')
      .select(['dao_source_id', 'event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', txHash)
      .execute();

    expect(chRows).toHaveLength(1);
    expect(chRows[0]?.dao_source_id).toBe(daoSourceId);
    expect(chRows[0]?.event_type).toBe('StartVote');
    const payload = JSON.parse(chRows[0]!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({
      voteId: '1',
      creator: '0x1111111111111111111111111111111111111111',
      metadata: 'Omnibus vote #1: Enable stETH withdrawals',
    });
  }, 30_000);

  // Era 2/3 fixture: CastObjection (objection phase — co-fires with CastVote in real txs)
  it('archives CastVote and CastObjection (Era 2/3 events) in the same block', async () => {
    const voter = '0x2222222222222222222222222222222222222222';
    const stake = 5_000_000_000_000_000_000_000n; // 5000 LDO

    const castVote = encodeLog('CastVote', [2n, voter, false, stake]);
    const castObjection = encodeLog('CastObjection', [2n, voter, stake]);
    const txHash = '0x' + '2b'.repeat(32);

    await listener([
      {
        sourceType: 'aragon_voting',
        chainId: CHAIN_ID,
        blockNumber: 17_000_000n,
        blockHash: '0x' + 'c2'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 0,
        address: VOTING_ADDRESS,
        topics: castVote.topics,
        data: castVote.data,
      },
      {
        sourceType: 'aragon_voting',
        chainId: CHAIN_ID,
        blockNumber: 17_000_000n,
        blockHash: '0x' + 'c2'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 1,
        address: VOTING_ADDRESS,
        topics: castObjection.topics,
        data: castObjection.data,
      },
    ]);

    const pgRows = await pgDb
      .selectFrom('archive_event')
      .select(['event_type', 'log_index'])
      .where('source_type', '=', 'aragon_voting')
      .where('tx_hash', '=', txHash)
      .orderBy('log_index')
      .execute();

    expect(pgRows).toHaveLength(2);
    expect(pgRows[0]?.event_type).toBe('CastVote');
    expect(pgRows[1]?.event_type).toBe('CastObjection');

    const chRows = await chDb
      .selectFrom('archive_event_aragon_voting')
      .select(['event_type', 'log_index', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', txHash)
      .orderBy('log_index')
      .execute();

    expect(chRows).toHaveLength(2);
    expect(chRows[0]?.event_type).toBe('CastVote');
    expect(chRows[1]?.event_type).toBe('CastObjection');

    const votePayload = JSON.parse(chRows[0]!.payload) as Record<string, unknown>;
    expect(votePayload).toMatchObject({
      voteId: '2',
      voter,
      supports: false,
      stake: stake.toString(),
    });

    const objPayload = JSON.parse(chRows[1]!.payload) as Record<string, unknown>;
    expect(objPayload).toMatchObject({
      voteId: '2',
      voter,
      stake: stake.toString(),
    });
  }, 30_000);

  it('archives ExecuteVote into CH and PG', async () => {
    const { topics, data } = encodeLog('ExecuteVote', [1n]);
    const txHash = '0x' + '3c'.repeat(32);

    await listener([
      {
        sourceType: 'aragon_voting',
        chainId: CHAIN_ID,
        blockNumber: 11_600_000n,
        blockHash: '0x' + 'd3'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 0,
        address: VOTING_ADDRESS,
        topics,
        data,
      },
    ]);

    const chRows = await chDb
      .selectFrom('archive_event_aragon_voting')
      .select(['event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', txHash)
      .execute();

    expect(chRows).toHaveLength(1);
    expect(chRows[0]?.event_type).toBe('ExecuteVote');
    const payload = JSON.parse(chRows[0]!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({ voteId: '1' });
  }, 30_000);
});
