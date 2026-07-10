import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { AiDlqRepository } from './ai-dlq-repository.js';
import type { NewAiDlq } from './schema.js';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;
class RollbackSignal extends Error {}
afterAll(async () => {
  await pgDb.destroy();
});
async function inRollback(fn: (trx: typeof pgDb) => Promise<void>): Promise<void> {
  await pgDb
    .transaction()
    .execute(async (trx) => {
      await fn(trx);
      throw new RollbackSignal();
    })
    .catch((err) => {
      if (!(err instanceof RollbackSignal)) throw err;
    });
}
function dlqRow(overrides: Partial<NewAiDlq> = {}): NewAiDlq {
  return {
    feature_name: 'test_summarizer',
    prompt_version: 'v1.0',
    input_hash: 'sha256:bbb',
    model: 'claude-haiku-4-5',
    raw_output: { not: 'valid' },
    zod_error: { issues: [] },
    attempts: 2,
    first_seen_at: new Date('2026-07-09T00:00:00Z'),
    last_seen_at: new Date('2026-07-09T00:00:00Z'),
    ...overrides,
  };
}

describeWithDb('AiDlqRepository (integration)', () => {
  it('persists a row on first insert', async () => {
    await inRollback(async (trx) => {
      await new AiDlqRepository(trx).insert(dlqRow());
      const row = await trx
        .selectFrom('ai_dlq')
        .selectAll()
        .where('input_hash', '=', 'sha256:bbb')
        .executeTakeFirstOrThrow();
      expect(row.attempts).toBe(2);
      expect(row.zod_error).toEqual({ issues: [] });
    });
  });

  it('bumps the same row on conflict (preserves first_seen_at, updates last_seen_at)', async () => {
    await inRollback(async (trx) => {
      const repo = new AiDlqRepository(trx);
      await repo.insert(dlqRow({ last_seen_at: new Date('2026-07-09T00:00:00Z') }));
      await repo.insert(
        dlqRow({
          first_seen_at: new Date('2030-01-01T00:00:00Z'), // must be ignored
          last_seen_at: new Date('2026-07-09T06:00:00Z'),
          attempts: 2,
        }),
      );
      const rows = await trx
        .selectFrom('ai_dlq')
        .selectAll()
        .where('input_hash', '=', 'sha256:bbb')
        .execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.first_seen_at).toEqual(new Date('2026-07-09T00:00:00Z'));
      expect(rows[0]?.last_seen_at).toEqual(new Date('2026-07-09T06:00:00Z'));
    });
  });
});
