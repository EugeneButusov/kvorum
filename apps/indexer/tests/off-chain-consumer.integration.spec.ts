import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DaoSourceRepository,
  DlqRepository,
  OffChainCursorRepository,
} from '@libs/db';
import type { OffChainArchiveWriteFn, PollItem, SourceContext } from '@sources/core';
import {
  insertTestDao,
  insertTestDaoSource,
  pgDb,
  truncateAllTestTables,
} from './helpers/pg-test-fixtures';
import { OffChainQueueProducer } from '../src/orchestrator/off-chain-queue-producer';
import { OffChainArchiveConsumer } from '../src/queue/off-chain-archive.consumer';
import type { OffChainArchiveJob } from '../src/queue/off-chain-archive.types';

// Off-chain consumer end-to-end against real Postgres (ADR-071 §off-chain consumer, Z2):
// mutable-latest insert/re-archive/skip, the CAS guard, watermark reset, DLQ, and cursor
// persistence. The per-source CH write is a synthetic in-memory stub (the real
// event_archive_snapshot table is Z3).
const DB_URL = process.env['DATABASE_URL'];
const describeIf = DB_URL ? describe : describe.skip;

const SOURCE_TYPE = 'offchain_source';
const OFF_CHAIN = 'off-chain';
const EXTERNAL_ID = 'proposal-0xabc';

describeIf('off-chain archive consumer', () => {
  let archiveEventRepo: ArchiveEventRepository;
  let daoSourceRepo: DaoSourceRepository;
  let derivation: ArchiveDerivationRepository;
  let cursorRepo: OffChainCursorRepository;
  let daoSourceId = '';
  let chWrites: Array<{ externalId: string; version: number; contentHash: string }> = [];
  let consumer: OffChainArchiveConsumer;

  beforeAll(async () => {
    archiveEventRepo = new ArchiveEventRepository(pgDb);
    daoSourceRepo = new DaoSourceRepository(pgDb);
    derivation = new ArchiveDerivationRepository(pgDb);
    cursorRepo = new OffChainCursorRepository(pgDb);

    const daoId = await insertTestDao(pgDb, { slug: 'offchain-dao', name: 'Off-chain DAO' });
    daoSourceId = await insertTestDaoSource(pgDb, {
      daoId,
      sourceType: SOURCE_TYPE,
      chainId: OFF_CHAIN,
      contractAddress: '0x' + '33'.repeat(20),
    });

    const writer: OffChainArchiveWriteFn = async (_ctx, item) => {
      chWrites.push({
        externalId: item.externalId,
        version: item.version,
        contentHash: item.contentHash,
      });
    };
    const writers = new Map<string, OffChainArchiveWriteFn>([[SOURCE_TYPE, writer]]);
    consumer = new OffChainArchiveConsumer(
      {} as never,
      daoSourceRepo,
      archiveEventRepo,
      writers,
      new DlqRepository(pgDb),
    );
  });

  beforeEach(async () => {
    chWrites = [];
    await sql`TRUNCATE archive_event, ingestion_dlq, off_chain_cursor RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
  });

  afterAll(async () => {
    await truncateAllTestTables(pgDb);
  });

  function job(contentHash: string, ordinal: string | null): OffChainArchiveJob {
    return {
      daoSourceId,
      sourceType: SOURCE_TYPE,
      externalId: EXTERNAL_ID,
      eventType: 'ProposalCreated',
      contentHash,
      ordinal,
      payload: { hash: contentHash },
    };
  }

  async function loadRow() {
    return pgDb
      .selectFrom('archive_event')
      .selectAll()
      .where('external_id', '=', EXTERNAL_ID)
      .executeTakeFirst();
  }

  it('mutable-latest lifecycle: insert → edit (re-archive + watermark reset) → skip → derivable', async () => {
    // New
    await consumer.consume(job('hash-v1', '10'));
    let row = await loadRow();
    expect(row?.content_hash).toBe('hash-v1');
    expect(row?.version).toBe(1);
    expect(row?.derivation_ordinal).toBe('10');
    expect(row?.derived_at).toBeNull();
    expect(chWrites).toEqual([{ externalId: EXTERNAL_ID, version: 1, contentHash: 'hash-v1' }]);

    // Simulate the row having been fully derived + actor-resolved with non-zero counts.
    await pgDb
      .updateTable('archive_event')
      .set({
        derived_at: sql`now()`,
        derivation_actor_resolved_at: sql`now()`,
        derivation_attempt_count: 3,
        actor_resolution_attempt_count: 2,
      })
      .where('external_id', '=', EXTERNAL_ID)
      .execute();

    // Edit (new content_hash) → re-archive, version bumps, ALL watermarks reset.
    await consumer.consume(job('hash-v2', '20'));
    row = await loadRow();
    expect(row?.content_hash).toBe('hash-v2');
    expect(row?.version).toBe(2);
    expect(row?.derivation_ordinal).toBe('20');
    expect(row?.derived_at).toBeNull();
    expect(row?.derivation_actor_resolved_at).toBeNull();
    expect(row?.derivation_attempt_count).toBe(0);
    expect(row?.actor_resolution_attempt_count).toBe(0);
    expect(chWrites.at(-1)).toEqual({
      externalId: EXTERNAL_ID,
      version: 2,
      contentHash: 'hash-v2',
    });

    // Unchanged re-poll → skip (no new CH write, version unchanged).
    await consumer.consume(job('hash-v2', '20'));
    row = await loadRow();
    expect(row?.version).toBe(2);
    expect(chWrites).toHaveLength(2);

    // Derivable: the off-chain read path surfaces it, ordered by derivation_ordinal.
    const underived = await derivation.findUnderivedOffchain(['ProposalCreated'], 50);
    expect(underived.map((r) => r.external_id)).toEqual([EXTERNAL_ID]);
  });

  it('CAS guard: reArchiveOffchain rejects an out-of-order stale version', async () => {
    await consumer.consume(job('hash-v1', '10')); // version 1
    await consumer.consume(job('hash-v2', '20')); // version 2

    // A stale edit carrying version 2 (<= current 2) must not clobber.
    const applied = await archiveEventRepo.reArchiveOffchain(
      { sourceType: SOURCE_TYPE, chainId: OFF_CHAIN, externalId: EXTERNAL_ID },
      { contentHash: 'hash-stale', version: 2, ordinal: '5' },
    );
    expect(applied).toBe(false);

    const row = await loadRow();
    expect(row?.content_hash).toBe('hash-v2');
    expect(row?.version).toBe(2);
  });

  it('dead-letters an unknown daoSourceId into ingestion_dlq', async () => {
    await consumer.consume({
      ...job('hash-v1', '10'),
      daoSourceId: '00000000-0000-0000-0000-000000000000',
    });

    const dlq = await pgDb
      .selectFrom('ingestion_dlq')
      .select(['stage', 'archive_source_type', 'archive_chain_id'])
      .executeTakeFirst();
    expect(dlq?.stage).toBe('off_chain_archive');
    expect(dlq?.archive_chain_id).toBe(OFF_CHAIN);
    expect(await loadRow()).toBeUndefined();
  });

  it('cursor persistence: upsert then load round-trips the partition-aware blob', async () => {
    await pgDb.transaction().execute(async (trx) => {
      await cursorRepo.upsert(trx, daoSourceId, { space: 'lido.eth', createdGte: 100, skip: 0 });
    });
    expect(await cursorRepo.load(daoSourceId)).toEqual({
      space: 'lido.eth',
      createdGte: 100,
      skip: 0,
    });

    await pgDb.transaction().execute(async (trx) => {
      await cursorRepo.upsert(trx, daoSourceId, { space: 'lido.eth', createdGte: 200, skip: 0 });
    });
    expect(await cursorRepo.load(daoSourceId)).toEqual({
      space: 'lido.eth',
      createdGte: 200,
      skip: 0,
    });
  });

  it('commitTick advances the cursor atomically; a send failure rolls it back', async () => {
    const source: SourceContext = {
      daoSourceId,
      sourceType: SOURCE_TYPE as never,
      chainId: OFF_CHAIN,
      sourceLabel: SOURCE_TYPE as never,
    };
    const item: PollItem = {
      externalId: EXTERNAL_ID,
      eventType: 'ProposalCreated',
      contentHash: 'h1',
      ordinal: '10',
      payload: {},
    };

    // Success: items "sent" + cursor advanced together.
    const okJobQueue = { sendInTx: async () => {} };
    const okProducer = new OffChainQueueProducer(okJobQueue as never, cursorRepo);
    await okProducer.commitTick(source, [item], { skip: 7 });
    expect(await cursorRepo.load(daoSourceId)).toEqual({ skip: 7 });

    // Failure: a throwing send rolls back the whole tick — cursor unchanged.
    const failJobQueue = {
      sendInTx: async () => {
        throw new Error('boss down');
      },
    };
    const failProducer = new OffChainQueueProducer(failJobQueue as never, cursorRepo);
    await expect(failProducer.commitTick(source, [item], { skip: 99 })).rejects.toThrow(
      'boss down',
    );
    expect(await cursorRepo.load(daoSourceId)).toEqual({ skip: 7 }); // not 99
  });
});
