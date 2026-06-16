import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import { chDb, ArchiveEventRepository, DlqRepository, pgDb } from '@libs/db';
import {
  AaveGovernorV2ArchiveWriter,
  AaveGovernorV2EventRepository,
  makeAaveGovernorV2IngesterListener,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const GOVERNOR_ADDRESS = '0xec568fffba86c094cf06b22134b23074dfe2252c';

type FixtureLog = {
  topics: string[];
  data: string;
};

function readFixture(name: string): FixtureLog {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', 'logs', name), 'utf8')) as FixtureLog;
}

describeIf('Aave governor-v2 ingestion integration', () => {
  let daoSourceId = '';
  let listener: ReturnType<typeof makeAaveGovernorV2IngesterListener>;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'aave_governor_v2' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-gov-v2-int-${Date.now()}`,
        name: 'Aave Governance v2 Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Aave governor v2 ingestion integration test',
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
        source_type: 'aave_governor_v2',
        chain_id: CHAIN_ID,
        source_config: { governor_address: GOVERNOR_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    const archiveWriter = new AaveGovernorV2ArchiveWriter({
      eventRepo: new AaveGovernorV2EventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });

    listener = makeAaveGovernorV2IngesterListener({
      archiveWriter,
      context: {
        daoSourceId,
        sourceType: 'aave_governor_v2',
        chainId: CHAIN_ID,
        sourceLabel: 'aave_governor_v2',
      },
      logger: silentLogger,
      dlqRepo: new DlqRepository(pgDb),
    });
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_aave_governor_v2 DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_aave_governor_v2 DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  it('archives ProposalCreated into CH and PG via the listener', async () => {
    const fixture = readFixture('governor-v2-proposal-created.json');
    const txHash = '0x' + '1a'.repeat(32);

    await listener([
      {
        sourceType: 'aave_governor_v2',
        chainId: CHAIN_ID,
        blockNumber: 11_500_000n,
        blockHash: '0x' + 'b1'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 0,
        address: GOVERNOR_ADDRESS,
        topics: fixture.topics,
        data: fixture.data,
      },
    ]);

    const pgRows = await pgDb
      .selectFrom('archive_event')
      .select(['source_type', 'chain_id', 'tx_hash', 'log_index', 'event_type', 'derived_at'])
      .where('source_type', '=', 'aave_governor_v2')
      .where('chain_id', '=', CHAIN_ID)
      .execute();

    expect(pgRows).toHaveLength(1);
    expect(pgRows[0]).toMatchObject({
      source_type: 'aave_governor_v2',
      chain_id: CHAIN_ID,
      tx_hash: txHash,
      log_index: 0,
      event_type: 'ProposalCreated',
      derived_at: null,
    });

    const chRows = await chDb
      .selectFrom('archive_event_aave_governor_v2')
      .select(['dao_source_id', 'event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', txHash)
      .execute();

    expect(chRows).toHaveLength(1);
    expect(chRows[0]?.dao_source_id).toBe(daoSourceId);
    expect(chRows[0]?.event_type).toBe('ProposalCreated');
    const payload = JSON.parse(chRows[0]!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({
      id: '42',
      creator: '0x1111111111111111111111111111111111111111',
    });
  }, 30_000);

  it('archives VoteEmitted into CH and PG and preserves votingPower', async () => {
    const fixture = readFixture('governor-v2-vote-emitted.json');
    const txHash = '0x' + '2b'.repeat(32);

    await listener([
      {
        sourceType: 'aave_governor_v2',
        chainId: CHAIN_ID,
        blockNumber: 11_600_000n,
        blockHash: '0x' + 'c2'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 0,
        address: GOVERNOR_ADDRESS,
        topics: fixture.topics,
        data: fixture.data,
      },
    ]);

    const chRows = await chDb
      .selectFrom('archive_event_aave_governor_v2')
      .select(['event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', txHash)
      .execute();

    expect(chRows).toHaveLength(1);
    expect(chRows[0]?.event_type).toBe('VoteEmitted');
    const payload = JSON.parse(chRows[0]!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({
      id: '42',
      voter: '0x2222222222222222222222222222222222222222',
      support: true,
      votingPower: '15000000000000000000000',
    });
  }, 30_000);
});
