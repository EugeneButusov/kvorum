import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { pgDb } from '@libs/db';
import type { PgDatabase } from '@libs/db';

export async function insertTestDao(
  db: Kysely<PgDatabase>,
  opts: { slug: string; name: string },
): Promise<string> {
  const row = await db
    .insertInto('dao')
    .values({
      slug: opts.slug,
      name: opts.name,
      primary_token_address: '0x' + '00'.repeat(20),
      primary_chain_id: '0x7a69',
      description: 'test dao',
      website_url: 'https://example.com',
      forum_url: 'https://forum.example.com',
      updated_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function insertTestDaoSource(
  db: Kysely<PgDatabase>,
  opts: { daoId: string; sourceType: string; chainId: string; contractAddress: string },
): Promise<string> {
  await db
    .insertInto('source_type')
    .values({ value: opts.sourceType })
    .onConflict((oc) => oc.column('value').doNothing())
    .execute();

  const row = await db
    .insertInto('dao_source')
    .values({
      dao_id: opts.daoId,
      source_type: opts.sourceType,
      source_config: { governor_address: opts.contractAddress },
      active_from_block: null,
      active_to_block: null,
      backfill_started_at_block: null,
      backfill_head_block: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function insertPendingConfirmation(
  db: Kysely<PgDatabase>,
  opts: {
    daoSourceId: string;
    chainId: string;
    blockHash: string;
    blockNumber: bigint;
    txHash: string;
    logIndex: number;
    sourceType: string;
  },
): Promise<string> {
  const row = await db
    .insertInto('archive_event')
    .values({
      source_type: opts.sourceType,
      dao_source_id: opts.daoSourceId,
      chain_id: opts.chainId,
      block_number: opts.blockNumber.toString(),
      block_hash: opts.blockHash,
      tx_hash: opts.txHash,
      log_index: opts.logIndex,
      event_type: 'ProposalCreated',
      received_at: new Date(),
      derived_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function truncateAllIngestionTables(db: Kysely<PgDatabase>): Promise<void> {
  // Preserves dao and dao_source — tests that seed them once in beforeAll (F3a, F3b pattern)
  // need these rows to persist across beforeEach calls.
  await sql`TRUNCATE archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(db);
}

export async function truncateAllTestTables(db: Kysely<PgDatabase>): Promise<void> {
  // Full teardown including dao/dao_source — call from afterAll so successive local
  // test runs don't collide on unique constraints. Not used in beforeEach (that
  // deliberately preserves dao/dao_source across iterations within a file).
  await sql`TRUNCATE dao, archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(db);
}

export async function pollUntil(
  fn: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

export { pgDb };
