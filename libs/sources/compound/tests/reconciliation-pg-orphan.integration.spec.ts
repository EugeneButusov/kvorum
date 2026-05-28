import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArchiveEventRepository,
  DaoSourceRepository,
  DlqRepository,
  pgDb,
  ReconciliationWatermarkRepository,
} from '@libs/db';
import {
  PgOrphanSweepService,
  RECONCILIATION_PG_ORPHAN_STAGE,
} from '../../../../apps/indexer/src/reconciliation/pg-orphan-sweep.service';

const DB_URL = process.env['DATABASE_URL'];
const describeIf = DB_URL ? describe : describe.skip;

const CHAIN_ID = '0x7a69';
const SOURCE_TYPE = 'compound_governor_bravo';

describeIf('reconciliation pg-orphan integration', () => {
  let daoSourceId = '';

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values({ value: SOURCE_TYPE })
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: 'recon-pg-orphan-test',
        name: 'Recon PG Orphan Test',
        primary_token_address: '0x' + '33'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'integration test',
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
        source_type: SOURCE_TYPE,
        source_config: { governor_address: '0x' + '44'.repeat(20) },
        active_from_block: '0',
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    daoSourceId = source.id;
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, reconciliation_watermark, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, reconciliation_watermark, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
  });

  it('routes missing CH tuple into reconciliation_pg_orphan_stage DLQ', async () => {
    const txHash = '0x' + 'ee'.repeat(32);
    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: SOURCE_TYPE,
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: '55',
        block_hash: '0x' + 'ff'.repeat(32),
        tx_hash: txHash,
        log_index: 7,
        event_type: 'ProposalCreated',
        received_at: new Date(),
        derived_at: null,
      })
      .execute();

    const svc = new PgOrphanSweepService(
      new DaoSourceRepository(pgDb),
      new ReconciliationWatermarkRepository(pgDb),
      new ArchiveEventRepository(pgDb),
      new DlqRepository(pgDb),
    );

    await svc.runOnce(daoSourceId);

    const dlq = await pgDb
      .selectFrom('ingestion_dlq')
      .selectAll()
      .where('stage', '=', RECONCILIATION_PG_ORPHAN_STAGE)
      .where('archive_tx_hash', '=', txHash)
      .execute();
    expect(dlq).toHaveLength(1);

    await svc.runOnce(daoSourceId);
    const dlqSecond = await pgDb
      .selectFrom('ingestion_dlq')
      .selectAll()
      .where('stage', '=', RECONCILIATION_PG_ORPHAN_STAGE)
      .where('archive_tx_hash', '=', txHash)
      .execute();
    expect(dlqSecond.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
