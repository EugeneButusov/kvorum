import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { AiOutputRepository } from './ai-output-repository.js';
import type { NewAiOutput } from './schema.js';

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

function baseRow(overrides: Partial<NewAiOutput> = {}): NewAiOutput {
  return {
    feature_name: 'test_summarizer',
    prompt_version: 'v1.0',
    input_hash: 'sha256:aaa',
    model: 'claude-haiku-4-5',
    output: { tldr: 'hello' },
    cost_usd: '0.002000',
    generated_at: new Date('2026-07-09T00:00:00Z'),
    source_provenance: { feature: 'test_summarizer' },
    ...overrides,
  };
}

describeWithDb('AiOutputRepository (integration)', () => {
  it('find returns undefined for an unknown key, the row after insert', async () => {
    await inRollback(async (trx) => {
      const repo = new AiOutputRepository(trx);
      expect(await repo.find('test_summarizer', 'v1.0', 'sha256:aaa')).toBeUndefined();
      const inserted = await repo.insert(baseRow());
      expect(inserted.output).toEqual({ tldr: 'hello' });
      const found = await repo.find('test_summarizer', 'v1.0', 'sha256:aaa');
      expect(found?.id).toBe(inserted.id);
    });
  });

  it('insert is idempotent on the unique key (ON CONFLICT DO NOTHING + find-fallback)', async () => {
    await inRollback(async (trx) => {
      const repo = new AiOutputRepository(trx);
      const first = await repo.insert(baseRow({ output: { tldr: 'first' } }));
      const second = await repo.insert(baseRow({ output: { tldr: 'second' } }));
      expect(second.id).toBe(first.id); // same row; the second insert was a no-op
      expect(second.output).toEqual({ tldr: 'first' }); // original preserved (immutable)
      const count = await trx
        .selectFrom('ai_output')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('feature_name', '=', 'test_summarizer')
        .where('prompt_version', '=', 'v1.0')
        .where('input_hash', '=', 'sha256:aaa')
        .executeTakeFirstOrThrow();
      expect(Number(count.n)).toBe(1);
    });
  });
});
