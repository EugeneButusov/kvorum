import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgDb } from './client';
import { DaoSourceRepository } from './dao-source-repository';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
});

// The archive fallback is the whole reason readPollCursor exists rather than a plain column read,
// and it is invisible to a mocked test: it depends on a real join between two tables and on the pg
// driver handing bigints back as strings. A source that finished a backfill yesterday must resume
// from its archive watermark, not from today's chain head.
describeWithDb('DaoSourceRepository poll cursor (integration)', () => {
  const suffix = randomUUID().slice(0, 8);
  let daoSourceId: string;
  let daoId: string;
  const repo = new DaoSourceRepository(pgDb);

  beforeAll(async () => {
    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `cursor-test-${suffix}`,
        name: 'Cursor Test DAO',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: '0x7a69',
        description: 'fixture',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoId = dao.id;

    await pgDb
      .insertInto('source_type')
      .values({ value: 'compound_governor' })
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const source = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: 'compound_governor',
        chain_id: '0x7a69',
        source_config: { governor_address: '0x' + '11'.repeat(20) },
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;
  });

  afterAll(async () => {
    await pgDb.deleteFrom('archive_event').where('dao_source_id', '=', daoSourceId).execute();
    await pgDb.deleteFrom('dao_source').where('id', '=', daoSourceId).execute();
    await pgDb.deleteFrom('dao').where('id', '=', daoId).execute();
  });

  async function archiveAt(blockNumber: string, logIndex: number): Promise<void> {
    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: 'compound_governor',
        dao_source_id: daoSourceId,
        chain_id: '0x7a69',
        block_number: blockNumber,
        block_hash: '0x' + logIndex.toString(16).padStart(64, '0'),
        tx_hash: '0x' + (logIndex + 500).toString(16).padStart(64, '0'),
        log_index: logIndex,
        event_type: 'ProposalCreated',
        received_at: new Date(),
      })
      .execute();
  }

  it('returns null for a source with no cursor and no archive', async () => {
    expect(await repo.readPollCursor(daoSourceId)).toBeNull();
  });

  it('falls back to the archive watermark when the source has never been polled', async () => {
    await archiveAt('19000000', 1);
    await archiveAt('19000500', 2);

    // Without this the poller would resume at chain head and silently skip everything the backfill
    // stopped short of — the exact gap this column exists to close.
    expect(await repo.readPollCursor(daoSourceId)).toBe(19_000_500n);
  });

  it('prefers the stored cursor over the archive watermark once written', async () => {
    await repo.writePollCursor(daoSourceId, 19_002_000n);

    expect(await repo.readPollCursor(daoSourceId)).toBe(19_002_000n);
  });

  it('advances an existing cursor forward', async () => {
    await repo.writePollCursor(daoSourceId, 19_003_000n);

    expect(await repo.readPollCursor(daoSourceId)).toBe(19_003_000n);
  });

  it('never moves the watermark backwards', async () => {
    await repo.writePollCursor(daoSourceId, 19_003_000n);
    await repo.writePollCursor(daoSourceId, 18_000_000n);

    // A regression would re-open a gap; concurrent or out-of-order ticks must not rewind it.
    expect(await repo.readPollCursor(daoSourceId)).toBe(19_003_000n);
  });

  it('round-trips a block height beyond 2^53', async () => {
    // bigint columns come back as strings precisely so heights outlive Number's safe range.
    const huge = 9_007_199_254_740_995n;
    await repo.writePollCursor(daoSourceId, huge);

    expect(await repo.readPollCursor(daoSourceId)).toBe(huge);
  });

  it('leaves the backfill watermarks untouched', async () => {
    await repo.writePollCursor(daoSourceId, 19_004_000n);

    // Different lifecycles sharing a row: the live path must not disturb a bounded run's checkpoint.
    const row = await pgDb
      .selectFrom('dao_source')
      .select(['backfill_started_at_block', 'backfill_head_block'])
      .where('id', '=', daoSourceId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ backfill_started_at_block: null, backfill_head_block: null });
  });
});
