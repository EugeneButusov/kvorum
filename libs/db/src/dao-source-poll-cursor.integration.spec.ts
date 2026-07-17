import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgDb } from './client';
import { DaoSourceRepository } from './dao-source-repository';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
});

// Exercises the watermark against a real database: the pg driver hands bigints back as strings, and
// the never-rewind guard is raw SQL — neither is visible to a mocked test. The 0011 seed that
// bootstraps pre-existing sources is covered by its own migration spec.
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

  it('returns null for a source that has never been scanned', async () => {
    // Null means "no position" — the poller starts at its confirmed-head window rather than genesis.
    expect(await repo.readPollCursor(daoSourceId)).toBeNull();
  });

  it('ignores the archive entirely', async () => {
    await archiveAt('19000000', 1);
    await archiveAt('19000500', 2);

    // The archive records what happened, not what was looked at. Deriving position from it would
    // leave a quiet source pinned to its last event, re-reading the same blocks forever.
    expect(await repo.readPollCursor(daoSourceId)).toBeNull();
  });

  it('reads back a written cursor', async () => {
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

// The 0011 seed is load-bearing: readPollCursor no longer infers anything from the archive, so a
// source predating the column resumes at chain head — a silent gap — unless this bootstraps it.
describeWithDb('0011 poll cursor seed', () => {
  const suffix = randomUUID().slice(0, 8);

  it('seeds pre-existing sources from their archive watermark and leaves the rest null', async () => {
    class RollbackSignal extends Error {}
    const { seedPollCursorsFromArchive } = await import(
      '../migrations/0011_dao_source_poll_cursor'
    );

    await expect(
      pgDb.transaction().execute(async (tx) => {
        const dao = await tx
          .insertInto('dao')
          .values({
            slug: `seed-test-${suffix}`,
            name: 'Seed Test DAO',
            primary_token_address: '0x' + '00'.repeat(20),
            primary_chain_id: '0x7a69',
            description: 'fixture',
            website_url: 'https://example.com',
            forum_url: 'https://forum.example.com',
            updated_at: new Date(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await tx
          .insertInto('source_type')
          .values({ value: 'compound_governor' })
          .onConflict((oc) => oc.column('value').doNothing())
          .execute();

        const mk = async (chainId: string) =>
          (
            await tx
              .insertInto('dao_source')
              .values({
                dao_id: dao.id,
                source_type: 'compound_governor',
                chain_id: chainId,
                source_config: { governor_address: '0x' + '11'.repeat(20) },
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;

        const archived = await mk('0x7a69');
        const untouched = await mk('0x7a6a');

        for (const [block, idx] of [
          ['19000000', 1],
          ['19000500', 2],
        ] as const) {
          await tx
            .insertInto('archive_event')
            .values({
              source_type: 'compound_governor',
              dao_source_id: archived,
              chain_id: '0x7a69',
              block_number: block,
              block_hash: '0x' + idx.toString(16).padStart(64, '0'),
              tx_hash: '0x' + (idx + 900).toString(16).padStart(64, '0'),
              log_index: idx,
              event_type: 'ProposalCreated',
              received_at: new Date(),
            })
            .execute();
        }

        await seedPollCursorsFromArchive(tx);

        const rows = await tx
          .selectFrom('dao_source')
          .select(['id', 'poll_cursor_block'])
          .where('dao_id', '=', dao.id)
          .execute();
        const byId = new Map(rows.map((r) => [r.id, r.poll_cursor_block]));

        // Highest archived block, not the lowest: the backfill read at least this far.
        expect(byId.get(archived)).toBe('19000500');
        // No archive = never scanned. Left null so the poller starts at its confirmed-head window
        // rather than inventing a position.
        expect(byId.get(untouched)).toBeNull();

        throw new RollbackSignal();
      }),
    ).rejects.toBeInstanceOf(RollbackSignal);
  });
});
