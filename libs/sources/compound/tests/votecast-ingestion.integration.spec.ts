import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import { chDb, ArchiveEventRepository, DlqRepository, pgDb } from '@libs/db';
import {
  ArchiveWriter,
  EventRepository,
  makeGovernorIngesterListener,
  type ArchiveWriteContext,
} from '@sources/compound';

type FixtureLog = {
  variant: 'compound_governor_alpha' | 'compound_governor_bravo' | 'compound_governor_oz';
  txHash: string;
  blockHash: string;
  logIndex: number;
  blockNumber: string;
  address: string;
  topics: string[];
  data: string;
};

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const ANVIL_RPC_URL = process.env['ANVIL_RPC_URL'];
const describeIf = DB_URL && CH_URL && ANVIL_RPC_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const CHAIN_ID_NUM = 1;

describeIf('VoteCast ingestion integration', () => {
  const daoSourceIds: Record<FixtureLog['variant'], string> = {
    compound_governor_alpha: '',
    compound_governor_bravo: '',
    compound_governor_oz: '',
  };

  const listeners = new Map<
    FixtureLog['variant'],
    ReturnType<typeof makeGovernorIngesterListener>
  >();

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([
        { value: 'compound_governor_alpha' },
        { value: 'compound_governor_bravo' },
        { value: 'compound_governor_oz' },
      ])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `compound-votecast-int-${Date.now()}`,
        name: 'Compound VoteCast Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'VoteCast integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const configs = [
      {
        source_type: 'compound_governor_alpha' as const,
        governor_address: '0xc0da01a04c3f3e0be433606045bb7017a7323e38',
      },
      {
        source_type: 'compound_governor_bravo' as const,
        governor_address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
      },
      {
        source_type: 'compound_governor_oz' as const,
        governor_address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
      },
    ];

    for (const cfg of configs) {
      const src = await pgDb
        .insertInto('dao_source')
        .values({
          dao_id: dao.id,
          source_type: cfg.source_type,
          chain_id: CHAIN_ID,
          source_config: { governor_address: cfg.governor_address },
          active_from_block: null,
          active_to_block: null,
          backfill_started_at_block: null,
          backfill_head_block: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      daoSourceIds[cfg.source_type] = src.id;

      const context: ArchiveWriteContext = {
        daoSourceId: src.id,
        sourceType: cfg.source_type,
        chainId: CHAIN_ID,
        sourceLabel: cfg.source_type,
        confirmationClassifier: () => 'confirmed',
      };

      const writer = new ArchiveWriter({
        eventRepo: new EventRepository({ chDb }),
        confirmationRepo: new ArchiveEventRepository(pgDb),
        dlqRepo: new DlqRepository(pgDb),
        logger: silentLogger,
      });

      listeners.set(
        cfg.source_type,
        makeIngesterListener({
          archiveWriter: writer,
          context,
          logger: silentLogger,
          dlqRepo: new DlqRepository(pgDb),
        }),
      );
    }
  }, 30_000);

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_compound_governor_bravo DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_compound_governor_bravo DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  it('replays fixture VoteCast logs into CH+PG archive with normalized payloads', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'logs', 'votecast-mainnet-fixture.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureLog[];

    for (const item of fixture) {
      const listener = listeners.get(item.variant);
      expect(listener).toBeDefined();

      await listener!([
        {
          sourceType: item.variant,
          chainId: CHAIN_ID_NUM,
          blockNumber: BigInt(item.blockNumber),
          blockHash: item.blockHash,
          txHash: item.txHash,
          txIndex: 0,
          logIndex: item.logIndex,
          address: item.address,
          topics: item.topics,
          data: item.data,
        },
      ]);
    }

    const confirmations = await pgDb
      .selectFrom('archive_event')
      .select(['source_type', 'dao_source_id', 'event_type'])
      .where('chain_id', '=', CHAIN_ID)
      .where('event_type', '=', 'VoteCast')
      .orderBy('source_type', 'asc')
      .execute();

    expect(confirmations).toHaveLength(3);
    expect(confirmations.map((r) => r.source_type)).toEqual([
      'compound_governor_alpha',
      'compound_governor_bravo',
      'compound_governor_oz',
    ]);
    const chRows = await chDb
      .selectFrom('archive_event_compound_governor_bravo')
      .select(['dao_source_id', 'event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('event_type', '=', 'VoteCast')
      .orderBy('log_index', 'asc')
      .execute();

    expect(chRows).toHaveLength(3);
    expect(chRows.every((r) => r.event_type === 'VoteCast')).toBe(true);

    const payloads = chRows.map((r) => JSON.parse(r.payload));
    expect(payloads[0]).toMatchObject({
      primaryChoice: 1,
      compound: { supportRaw: true, reason: null },
    });
    expect(payloads[1]).toMatchObject({
      primaryChoice: 2,
      compound: { supportRaw: 2, reason: 'abstain for risk' },
    });
    expect(payloads[2]).toMatchObject({
      primaryChoice: 1,
      compound: { supportRaw: 1, reason: 'for upgrade' },
    });

    const daoSourceSet = new Set(chRows.map((r) => r.dao_source_id));
    expect(daoSourceSet.has(daoSourceIds.compound_governor_alpha)).toBe(true);
    expect(daoSourceSet.has(daoSourceIds.compound_governor_bravo)).toBe(true);
    expect(daoSourceSet.has(daoSourceIds.compound_governor_oz)).toBe(true);
  }, 30_000);
});
