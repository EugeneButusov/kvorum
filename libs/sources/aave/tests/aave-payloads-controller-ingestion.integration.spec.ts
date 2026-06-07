import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import { chDb, ArchiveEventRepository, DlqRepository, pgDb } from '@libs/db';
import {
  AavePayloadsControllerArchiveWriter,
  AavePayloadsControllerEventRepository,
  createAavePayloadsControllerPlugin,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';

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

describeIf('Aave payloads-controller ingestion integration', () => {
  let daoSourceId = '';
  let consumer: NonNullable<
    ReturnType<typeof createAavePayloadsControllerPlugin>['buildArchiveConsumer']
  >;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'aave_payloads_controller' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-pc-int-${Date.now()}`,
        name: 'Aave Payloads Controller Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Aave payloads controller ingestion integration test',
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
        source_type: 'aave_payloads_controller',
        chain_id: CHAIN_ID,
        source_config: {
          payloads_controller_address: '0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5',
        },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    consumer = createAavePayloadsControllerPlugin({
      archiveWriter: new AavePayloadsControllerArchiveWriter({
        eventRepo: new AavePayloadsControllerEventRepository({ chDb }),
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
    await sql`ALTER TABLE archive_event_aave_payloads_controller DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_aave_payloads_controller DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  it('archives PayloadCreated into CH and PG via the consumer path', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'logs', 'payload-created.json');
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
        sourceType: 'aave_payloads_controller',
        chainId: CHAIN_ID,
        sourceLabel: 'aave_payloads_controller',
      },
      raw,
    );

    const pgRows = await pgDb
      .selectFrom('archive_event')
      .select(['source_type', 'chain_id', 'tx_hash', 'log_index', 'derived_at'])
      .where('source_type', '=', 'aave_payloads_controller')
      .where('chain_id', '=', CHAIN_ID)
      .execute();

    expect(pgRows).toHaveLength(1);
    expect(pgRows[0]).toMatchObject({
      source_type: 'aave_payloads_controller',
      chain_id: CHAIN_ID,
      tx_hash: raw.txHash,
      log_index: raw.logIndex,
      derived_at: null,
    });

    const chRows = await chDb
      .selectFrom('archive_event_aave_payloads_controller')
      .select(['dao_source_id', 'event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', raw.txHash)
      .execute();

    expect(chRows).toHaveLength(1);
    expect(chRows[0]?.dao_source_id).toBe(daoSourceId);
    expect(chRows[0]?.event_type).toBe('PayloadCreated');
    expect(JSON.parse(chRows[0]!.payload)).toMatchObject({
      payloadId: '321',
      creator: '0x1234567890abcdef1234567890abcdef12345678',
      maximumAccessLevelRequired: 2,
    });
    expect(JSON.parse(chRows[0]!.payload).actions).toHaveLength(2);
  }, 30_000);
});
