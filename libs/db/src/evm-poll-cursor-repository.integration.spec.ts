import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgDb } from './client';
import { EvmPollCursorRepository } from './evm-poll-cursor-repository';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
});

// The fallback to max(archive_event.block_number) is the whole reason this repository exists rather
// than a plain table read, and it is invisible to a mocked test: it depends on a real join between
// two tables and on the pg driver handing bigints back as strings. A source that finished a backfill
// yesterday must resume from its archive watermark, not from today's chain head.
describeWithDb('EvmPollCursorRepository (integration)', () => {
  const suffix = randomUUID().slice(0, 8);
  let daoSourceId: string;
  let daoId: string;
  const repo = new EvmPollCursorRepository(pgDb);

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
    // evm_poll_cursor and archive_event cascade from dao_source.
    await pgDb.deleteFrom('archive_event').where('dao_source_id', '=', daoSourceId).execute();
    await pgDb.deleteFrom('evm_poll_cursor').where('dao_source_id', '=', daoSourceId).execute();
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
    expect(await repo.read(daoSourceId)).toBeNull();
  });

  it('falls back to the archive watermark when the source has never been polled', async () => {
    await archiveAt('19000000', 1);
    await archiveAt('19000500', 2);

    // Without this the poller would resume at chain head and silently skip everything the backfill
    // stopped short of — the exact gap this table exists to close.
    expect(await repo.read(daoSourceId)).toBe(19_000_500n);
  });

  it('prefers the stored cursor over the archive watermark once written', async () => {
    await repo.write(daoSourceId, 19_002_000n);

    expect(await repo.read(daoSourceId)).toBe(19_002_000n);
  });

  it('upserts an existing cursor forward', async () => {
    await repo.write(daoSourceId, 19_003_000n);

    expect(await repo.read(daoSourceId)).toBe(19_003_000n);
  });

  it('never moves the watermark backwards', async () => {
    await repo.write(daoSourceId, 19_003_000n);
    await repo.write(daoSourceId, 18_000_000n);

    // A regression would re-open a gap; concurrent or out-of-order ticks must not rewind it.
    expect(await repo.read(daoSourceId)).toBe(19_003_000n);
  });

  it('round-trips a block height beyond 2^53', async () => {
    // bigint columns come back as strings precisely so heights outlive Number's safe range.
    const huge = 9_007_199_254_740_995n;
    await repo.write(daoSourceId, huge);

    expect(await repo.read(daoSourceId)).toBe(huge);
  });
});
