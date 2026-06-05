import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import { chDb, ArchiveEventRepository, DlqRepository, pgDb } from '@libs/db';
import {
  AaveVotingMachineArchiveWriter,
  AaveVotingMachineEventRepository,
  createAaveVotingMachinePlugin,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0xa86a';

type FixtureLog = {
  chainId: string;
  address: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  topics: string[];
  data: string;
};

describeIf('Aave voting-machine ingestion integration', () => {
  let daoSourceId = '';
  let consumer: NonNullable<
    ReturnType<typeof createAaveVotingMachinePlugin>['buildArchiveConsumer']
  >;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'aave_voting_machine' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-vm-int-${Date.now()}`,
        name: 'Aave Voting Machine Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Aave voting machine ingestion integration test',
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
        source_type: 'aave_voting_machine',
        chain_id: CHAIN_ID,
        source_config: { voting_machine_address: '0x4D1863d22D0ED8579f8999388BCC833CB057C2d6' },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    consumer = createAaveVotingMachinePlugin({
      archiveWriter: new AaveVotingMachineArchiveWriter({
        eventRepo: new AaveVotingMachineEventRepository({ chDb }),
        archiveEventRepo: new ArchiveEventRepository(pgDb),
        dlqRepo: new DlqRepository(pgDb),
        logger: silentLogger,
      }),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    }).buildArchiveConsumer!();
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_aave_voting_machine DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_aave_voting_machine DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  it('archives VoteEmitted into CH and PG via the consumer path', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'logs', 'vote-emitted.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureLog;
    const raw = {
      chainId: fixture.chainId,
      blockNumber: fixture.blockNumber,
      blockHash: fixture.blockHash,
      txHash: fixture.txHash,
      logIndex: fixture.logIndex,
      address: fixture.address,
      topics: fixture.topics,
      data: fixture.data,
    };

    await consumer(
      {
        daoSourceId,
        sourceType: 'aave_voting_machine',
        chainId: CHAIN_ID,
        sourceLabel: 'aave_voting_machine',
      },
      raw,
    );

    const pgRows = await pgDb
      .selectFrom('archive_event')
      .select(['source_type', 'chain_id', 'tx_hash', 'log_index', 'derived_at'])
      .where('source_type', '=', 'aave_voting_machine')
      .where('chain_id', '=', CHAIN_ID)
      .execute();

    expect(pgRows).toHaveLength(1);
    expect(pgRows[0]).toMatchObject({
      source_type: 'aave_voting_machine',
      chain_id: CHAIN_ID,
      tx_hash: raw.txHash,
      log_index: raw.logIndex,
      derived_at: null,
    });

    const chRows = await chDb
      .selectFrom('archive_event_aave_voting_machine')
      .select(['dao_source_id', 'event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', raw.txHash)
      .execute();

    expect(chRows).toHaveLength(1);
    expect(chRows[0]?.dao_source_id).toBe(daoSourceId);
    expect(chRows[0]?.event_type).toBe('VoteEmitted');
    expect(JSON.parse(chRows[0]!.payload)).toMatchObject({
      proposalId: '489',
      voter: '0x4d4ac65513fee380c596ac9edfac588782831bdf',
      support: true,
    });
  }, 30_000);
});
