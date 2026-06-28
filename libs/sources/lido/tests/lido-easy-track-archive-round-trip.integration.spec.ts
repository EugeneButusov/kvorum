import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import { chDb, ArchiveEventRepository, DlqRepository, pgDb } from '@libs/db';
import {
  EasyTrackEventRepository,
  LidoEasyTrackArchiveWriter,
  makeEasyTrackIngesterListener,
  EASY_TRACK_INTERFACE,
} from '@sources/lido';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const EASY_TRACK_ADDRESS = '0xf0211b7660680b49de1a7e9f25c65660f0a13fea';
const CREATOR = '0x1111111111111111111111111111111111111111';
const FACTORY = '0x2222222222222222222222222222222222222222';
const OBJECTOR = '0x3333333333333333333333333333333333333333';

function etLog(eventName: string, args: unknown[]) {
  const fragment = EASY_TRACK_INTERFACE.getEvent(eventName)!;
  const encoded = EASY_TRACK_INTERFACE.encodeEventLog(fragment, args);
  return { topics: encoded.topics as string[], data: encoded.data };
}

describeIf('Lido Easy Track ingestion integration', () => {
  let daoSourceId = '';
  let listener: ReturnType<typeof makeEasyTrackIngesterListener>;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'easy_track' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lido-et-int-${Date.now()}`,
        name: 'Lido Easy Track Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Lido Easy Track ingestion integration test',
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
        source_type: 'easy_track',
        chain_id: CHAIN_ID,
        source_config: { easy_track_address: EASY_TRACK_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    const archiveWriter = new LidoEasyTrackArchiveWriter({
      eventRepo: new EasyTrackEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });

    listener = makeEasyTrackIngesterListener({
      archiveWriter,
      context: {
        daoSourceId,
        sourceType: 'easy_track',
        chainId: CHAIN_ID,
        sourceLabel: 'easy_track',
      },
      logger: silentLogger,
      dlqRepo: new DlqRepository(pgDb),
    });
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_easy_track DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_easy_track DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  // A created→enacted motion: the happy optimistic path. Archives one MotionCreated (carrying the
  // factory + EVMScript) and one MotionEnacted in the enacting tx.
  it('archives a created→enacted motion lifecycle (CH + PG watermark)', async () => {
    const created = etLog('MotionCreated', [42n, CREATOR, FACTORY, '0xc0ffee', '0xdeadbeef']);
    const createdTx = '0x' + '1a'.repeat(32);
    const enacted = etLog('MotionEnacted', [42n]);
    const enactedTx = '0x' + '2b'.repeat(32);

    await listener([
      {
        sourceType: 'easy_track',
        chainId: CHAIN_ID,
        blockNumber: 13_700_000n,
        blockHash: '0x' + 'b1'.repeat(32),
        txHash: createdTx,
        txIndex: 0,
        logIndex: 0,
        address: EASY_TRACK_ADDRESS,
        topics: created.topics,
        data: created.data,
      },
      {
        sourceType: 'easy_track',
        chainId: CHAIN_ID,
        blockNumber: 13_715_600n,
        blockHash: '0x' + 'c2'.repeat(32),
        txHash: enactedTx,
        txIndex: 0,
        logIndex: 0,
        address: EASY_TRACK_ADDRESS,
        topics: enacted.topics,
        data: enacted.data,
      },
    ]);

    const pgRows = await pgDb
      .selectFrom('archive_event')
      .select(['event_type', 'tx_hash'])
      .where('source_type', '=', 'easy_track')
      .orderBy('block_number')
      .execute();
    expect(pgRows.map((r) => r.event_type)).toEqual(['MotionCreated', 'MotionEnacted']);

    const createdRow = await chDb
      .selectFrom('archive_event_easy_track')
      .select(['event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', createdTx)
      .execute();
    expect(createdRow).toHaveLength(1);
    expect(JSON.parse(createdRow[0]!.payload)).toMatchObject({
      motionId: '42',
      creator: CREATOR,
      evmScriptFactory: FACTORY,
      evmScriptCallData: '0xc0ffee',
      evmScript: '0xdeadbeef',
    });

    const enactedRow = await chDb
      .selectFrom('archive_event_easy_track')
      .select(['event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', enactedTx)
      .execute();
    expect(enactedRow).toHaveLength(1);
    expect(enactedRow[0]?.event_type).toBe('MotionEnacted');
    expect(JSON.parse(enactedRow[0]!.payload)).toEqual({ motionId: '42' });
  }, 30_000);

  // A created→objected→rejected motion: the objection path. The running MotionObjected tally and the
  // terminal MotionRejected archive as distinct rows.
  it('archives an objected→rejected motion with the running objection tally', async () => {
    const objected = etLog('MotionObjected', [43n, OBJECTOR, 1000n, 2500n, 50n]);
    const rejected = etLog('MotionRejected', [43n]);
    const txHash = '0x' + '3c'.repeat(32);

    await listener([
      {
        sourceType: 'easy_track',
        chainId: CHAIN_ID,
        blockNumber: 13_720_000n,
        blockHash: '0x' + 'd3'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 0,
        address: EASY_TRACK_ADDRESS,
        topics: objected.topics,
        data: objected.data,
      },
      {
        sourceType: 'easy_track',
        chainId: CHAIN_ID,
        blockNumber: 13_720_000n,
        blockHash: '0x' + 'd3'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 1,
        address: EASY_TRACK_ADDRESS,
        topics: rejected.topics,
        data: rejected.data,
      },
    ]);

    const chRows = await chDb
      .selectFrom('archive_event_easy_track')
      .select(['event_type', 'log_index', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', txHash)
      .orderBy('log_index')
      .execute();
    expect(chRows.map((r) => r.event_type)).toEqual(['MotionObjected', 'MotionRejected']);
    expect(JSON.parse(chRows[0]!.payload)).toMatchObject({
      motionId: '43',
      objector: OBJECTOR,
      newObjectionsAmount: '2500',
      newObjectionsAmountPct: '50',
    });
    expect(JSON.parse(chRows[1]!.payload)).toEqual({ motionId: '43' });
  }, 30_000);

  // Idempotency: re-delivering the same log does not create a duplicate PG watermark row (the 4-tuple
  // find() short-circuit) — the backfill/live rescan-window guarantee.
  it('is idempotent on re-delivery of the same log (PG 4-tuple)', async () => {
    const enacted = etLog('MotionEnacted', [44n]);
    const job = {
      sourceType: 'easy_track' as const,
      chainId: CHAIN_ID,
      blockNumber: 13_730_000n,
      blockHash: '0x' + 'e4'.repeat(32),
      txHash: '0x' + '4d'.repeat(32),
      txIndex: 0,
      logIndex: 0,
      address: EASY_TRACK_ADDRESS,
      topics: enacted.topics,
      data: enacted.data,
    };

    await listener([job]);
    await listener([job]);

    const pgRows = await pgDb
      .selectFrom('archive_event')
      .select(['id'])
      .where('source_type', '=', 'easy_track')
      .where('tx_hash', '=', job.txHash)
      .execute();
    expect(pgRows).toHaveLength(1);
  }, 30_000);
});
