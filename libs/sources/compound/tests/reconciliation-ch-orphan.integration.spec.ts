import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArchiveEventRepository,
  chDb,
  DaoSourceRepository,
  pgDb,
  ReconciliationWatermarkRepository,
} from '@libs/db';
import { ChOrphanSweepService } from '../../../../apps/indexer/src/reconciliation/ch-orphan-sweep.service';

const DB_URL = process.env['DATABASE_URL'];
const describeIf = DB_URL ? describe : describe.skip;

const CHAIN_ID = '0x7a69';
const SOURCE_TYPE = 'compound_governor_bravo';

function chainConfigJson() {
  return JSON.stringify({
    chains: [
      {
        chainId: CHAIN_ID,
        name: 'anvil',
        headLag: 2,
        providers: [{ name: 'stub', url: 'http://localhost:8545', kind: 'http', priority: 1 }],
      },
    ],
  });
}

describeIf('reconciliation ch-orphan integration', () => {
  let daoSourceId = '';

  beforeAll(async () => {
    process.env['CHAIN_CONFIG'] = chainConfigJson();

    await pgDb
      .insertInto('source_type')
      .values({ value: SOURCE_TYPE })
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: 'recon-ch-orphan-test',
        name: 'Recon CH Orphan Test',
        primary_token_address: '0x' + '11'.repeat(20),
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
        source_config: { governor_address: '0x' + '22'.repeat(20) },
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
    await sql`ALTER TABLE archive_event_compound_governor_bravo DELETE WHERE dao_source_id = ${daoSourceId}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, reconciliation_watermark, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_compound_governor_bravo DELETE WHERE dao_source_id = ${daoSourceId}`.execute(
      chDb,
    );
  });

  it('materializes missing PG archive_event row from CH', async () => {
    const txHash = '0x' + 'aa'.repeat(32);
    await chDb
      .insertInto('archive_event_compound_governor_bravo')
      .values({
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: '12',
        block_hash: '0x' + 'bb'.repeat(32),
        tx_hash: txHash,
        log_index: 1,
        event_type: 'ProposalCreated',
        payload: JSON.stringify({ proposalId: '1' }),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_compound_governor_bravo'>>['values']
      >[0])
      .execute();

    const svc = new ChOrphanSweepService(
      new DaoSourceRepository(pgDb),
      new ArchiveEventRepository(pgDb),
      new ReconciliationWatermarkRepository(pgDb),
      { getOrCreate: async () => ({ client: { send: async () => '0x20' } }) } as never,
      ['ProposalCreated'],
    );

    await svc.runOnce(CHAIN_ID);

    const row = await pgDb
      .selectFrom('archive_event')
      .selectAll()
      .where('dao_source_id', '=', daoSourceId)
      .where('tx_hash', '=', txHash)
      .executeTakeFirst();

    expect(row).toBeDefined();

    await svc.runOnce(CHAIN_ID);
    const rows = await pgDb
      .selectFrom('archive_event')
      .selectAll()
      .where('dao_source_id', '=', daoSourceId)
      .where('tx_hash', '=', txHash)
      .execute();
    expect(rows).toHaveLength(1);
  }, 30_000);

  it('skips CH rows with unknown event_type not in allowlist', async () => {
    const txHash = '0x' + 'cc'.repeat(32);
    await chDb
      .insertInto('archive_event_compound_governor_bravo')
      .values({
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: '13',
        block_hash: '0x' + 'dd'.repeat(32),
        tx_hash: txHash,
        log_index: 2,
        event_type: 'UnknownFutureEvent',
        payload: JSON.stringify({ foo: 'bar' }),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_compound_governor_bravo'>>['values']
      >[0])
      .execute();

    const svc = new ChOrphanSweepService(
      new DaoSourceRepository(pgDb),
      new ArchiveEventRepository(pgDb),
      new ReconciliationWatermarkRepository(pgDb),
      { getOrCreate: async () => ({ client: { send: async () => '0x20' } }) } as never,
      ['ProposalCreated'],
    );

    await svc.runOnce(CHAIN_ID);

    const row = await pgDb
      .selectFrom('archive_event')
      .selectAll()
      .where('dao_source_id', '=', daoSourceId)
      .where('tx_hash', '=', txHash)
      .executeTakeFirst();

    expect(row).toBeUndefined();
  }, 30_000);
});
