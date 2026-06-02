import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import { chDb, ArchiveEventRepository, DlqRepository, pgDb } from '@libs/db';
import {
  AaveGovernanceArchiveWriter,
  AaveGovernanceEventRepository,
  createAaveGovernanceV3Plugin,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';

type FixtureLog = {
  topics: string[];
  data: string;
};

describeIf('Aave governance-v3 ingestion integration', () => {
  let daoSourceId = '';
  let consumer: NonNullable<
    ReturnType<typeof createAaveGovernanceV3Plugin>['buildArchiveConsumer']
  >;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'aave_governance_v3' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-gov-v3-int-${Date.now()}`,
        name: 'Aave Governance v3 Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Aave governance ingestion integration test',
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
        source_type: 'aave_governance_v3',
        chain_id: CHAIN_ID,
        source_config: { governance_address: '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7' },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    consumer = createAaveGovernanceV3Plugin({
      archiveWriter: new AaveGovernanceArchiveWriter({
        eventRepo: new AaveGovernanceEventRepository({ chDb }),
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
    await sql`ALTER TABLE archive_event_aave_governance_v3 DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_aave_governance_v3 DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  it('archives ProposalCreated into CH and PG via the consumer path', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'logs', 'proposal-created.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureLog;
    const raw = {
      chainId: CHAIN_ID,
      blockNumber: '101',
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      logIndex: 0,
      address: '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7',
      topics: fixture.topics,
      data: fixture.data,
    };

    await consumer(
      {
        daoSourceId,
        sourceType: 'aave_governance_v3',
        chainId: CHAIN_ID,
        sourceLabel: 'aave_governance_v3',
      },
      raw,
    );

    const pgRows = await pgDb
      .selectFrom('archive_event')
      .select(['source_type', 'chain_id', 'tx_hash', 'log_index', 'derived_at'])
      .where('source_type', '=', 'aave_governance_v3')
      .where('chain_id', '=', CHAIN_ID)
      .execute();

    expect(pgRows).toHaveLength(1);
    expect(pgRows[0]).toMatchObject({
      source_type: 'aave_governance_v3',
      chain_id: CHAIN_ID,
      tx_hash: raw.txHash,
      log_index: raw.logIndex,
      derived_at: null,
    });

    const chRows = await chDb
      .selectFrom('archive_event_aave_governance_v3')
      .select(['dao_source_id', 'event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', raw.txHash)
      .execute();

    expect(chRows).toHaveLength(1);
    expect(chRows[0]?.dao_source_id).toBe(daoSourceId);
    expect(chRows[0]?.event_type).toBe('ProposalCreated');
    expect(JSON.parse(chRows[0]!.payload)).toMatchObject({
      proposalId: '101',
      creator: '0x1111111111111111111111111111111111111111',
      accessLevel: 2,
    });
  }, 30_000);
});
