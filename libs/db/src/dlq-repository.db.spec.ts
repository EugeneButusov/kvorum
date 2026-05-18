import { pgDb } from './client';
import { DlqRepository } from './dlq-repository';
import type { NewIngestionDlq } from './schema/pg';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

class RollbackSignal extends Error {}

afterAll(async () => {
  await pgDb.destroy();
});

const BASE_DLQ_ROW: NewIngestionDlq = {
  stage: 'archive_write',
  source: 'compound_governor_bravo',
  payload: { raw: { topics: [], data: '0x' }, block_number: '20000000' },
  error: { name: 'Error', message: 'write failed' },
  retries: 1,
  first_seen_at: new Date('2026-01-01T00:00:00Z'),
  last_attempt_at: new Date('2026-01-01T00:00:01Z'),
  archive_source_type: 'compound_governor_bravo',
  archive_chain_id: 1,
  archive_tx_hash: '0x' + '1'.repeat(64),
  archive_log_index: 0,
  archive_block_hash: '0x' + '2'.repeat(64),
};

async function seedDlqRow(
  trx: typeof pgDb,
  overrides: Partial<NewIngestionDlq> = {},
): Promise<string> {
  const [row] = await trx
    .insertInto('ingestion_dlq')
    .values({ ...BASE_DLQ_ROW, ...overrides })
    .returning(['id'])
    .execute();
  return row!.id;
}

describeWithDb('DlqRepository (integration)', () => {
  it('list() returns rows ordered by first_seen_at asc', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DlqRepository(trx as never);
        const id1 = await seedDlqRow(trx, {
          first_seen_at: new Date('2026-01-01T00:00:00Z'),
          archive_tx_hash: '0x' + 'a'.repeat(64),
        });
        const id2 = await seedDlqRow(trx, {
          first_seen_at: new Date('2026-01-02T00:00:00Z'),
          archive_tx_hash: '0x' + 'b'.repeat(64),
        });

        const rows = await repo.list({ limit: 10 });
        const ids = rows.map((r) => r.id);
        expect(ids.indexOf(id1)).toBeLessThan(ids.indexOf(id2));

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('list() filters by source when provided', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DlqRepository(trx as never);
        const id1 = await seedDlqRow(trx, {
          source: 'compound_governor_bravo',
          archive_tx_hash: '0x' + 'c'.repeat(64),
        });
        await seedDlqRow(trx, {
          source: 'other_source',
          archive_tx_hash: '0x' + 'd'.repeat(64),
        });

        const rows = await repo.list({ source: 'compound_governor_bravo', limit: 10 });
        expect(rows.every((r) => r.source === 'compound_governor_bravo')).toBe(true);
        expect(rows.some((r) => r.id === id1)).toBe(true);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('getById() returns the row or undefined', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DlqRepository(trx as never);
        const id = await seedDlqRow(trx, { archive_tx_hash: '0x' + 'e'.repeat(64) });

        const found = await repo.getById(id);
        expect(found?.id).toBe(id);

        const missing = await repo.getById('00000000-0000-0000-0000-000000000000');
        expect(missing).toBeUndefined();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('accept() moves the row to resolved with resolution_kind=accepted and removes it from dlq', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DlqRepository(trx as never);
        const id = await seedDlqRow(trx, { archive_tx_hash: '0x' + 'f'.repeat(64) });

        const result = await repo.accept(id, 'manual review passed', 'alice');

        expect(result).toBe('accepted');

        const dlqRow = await trx
          .selectFrom('ingestion_dlq')
          .where('id', '=', id)
          .selectAll()
          .executeTakeFirst();
        expect(dlqRow).toBeUndefined();

        const resolved = await trx
          .selectFrom('ingestion_dlq_resolved')
          .where('original_dlq_id', '=', id)
          .selectAll()
          .executeTakeFirst();
        expect(resolved?.resolution_kind).toBe('accepted');
        expect(resolved?.reason).toBe('manual review passed');
        expect(resolved?.resolved_by).toBe('alice');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('accept() returns not_found for an unknown id', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DlqRepository(trx as never);
        const result = await repo.accept(
          '00000000-0000-0000-0000-000000000000',
          'irrelevant',
          'alice',
        );
        expect(result).toBe('not_found');
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('accept() returns already_resolved when original_dlq_id conflicts', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DlqRepository(trx as never);
        const id = await seedDlqRow(trx, { archive_tx_hash: '0x' + '3'.repeat(64) });

        await repo.accept(id, 'first', 'alice');

        // Re-insert the row with same id to simulate a second accept attempt
        // (the row was deleted, so we re-insert to trigger the unique conflict path)
        await trx
          .insertInto('ingestion_dlq')
          .values({ ...BASE_DLQ_ROW, id, archive_tx_hash: '0x' + '3'.repeat(64) } as never)
          .execute();

        const result = await repo.accept(id, 'second', 'bob');
        expect(result).toBe('already_resolved');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('markRetrySucceeded() moves the row with resolution_kind=retry_succeeded', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DlqRepository(trx as never);
        const id = await seedDlqRow(trx, { archive_tx_hash: '0x' + '4'.repeat(64) });

        const result = await repo.markRetrySucceeded(id, 'archive re-written', 'admin-cli');

        expect(result).toBe('resolved');

        const dlqRow = await trx
          .selectFrom('ingestion_dlq')
          .where('id', '=', id)
          .selectAll()
          .executeTakeFirst();
        expect(dlqRow).toBeUndefined();

        const resolved = await trx
          .selectFrom('ingestion_dlq_resolved')
          .where('original_dlq_id', '=', id)
          .selectAll()
          .executeTakeFirst();
        expect(resolved?.resolution_kind).toBe('retry_succeeded');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('markRetrySucceeded() returns not_found for an unknown id', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DlqRepository(trx as never);
        const result = await repo.markRetrySucceeded(
          '00000000-0000-0000-0000-000000000000',
          'irrelevant',
          'admin-cli',
        );
        expect(result).toBe('not_found');
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('markRetrySucceeded() returns already_resolved on duplicate original_dlq_id', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DlqRepository(trx as never);
        const id = await seedDlqRow(trx, { archive_tx_hash: '0x' + '5'.repeat(64) });

        await repo.markRetrySucceeded(id, 'first', 'admin-cli');

        await trx
          .insertInto('ingestion_dlq')
          .values({ ...BASE_DLQ_ROW, id, archive_tx_hash: '0x' + '5'.repeat(64) } as never)
          .execute();

        const result = await repo.markRetrySucceeded(id, 'second', 'admin-cli');
        expect(result).toBe('already_resolved');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
