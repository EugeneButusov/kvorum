import { afterAll, describe, expect, it, vi } from 'vitest';
import { AiCompletionCache, type GeneratedCompletion } from './ai-completion-cache';
import { pgDb } from './client';

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
function generated(overrides: Partial<GeneratedCompletion> = {}): GeneratedCompletion {
  return {
    model: 'claude-haiku-4-5',
    output: { tldr: 'raises reserve factor' },
    costUsd: 0.002,
    inputTokens: 1000,
    outputTokens: 200,
    sourceProvenance: { feature: 'test_summarizer', model: 'claude-haiku-4-5' },
    daoId: null,
    entityReference: 'compound:42',
    ...overrides,
  };
}
const LOOKUP = { featureName: 'test_summarizer', promptVersion: 'v1.0', inputHash: 'sha256:ccc' };

describeWithDb('AiCompletionCache.getOrGenerate (integration)', () => {
  it('miss: runs generate once, writes ai_output + ai_cost_log', async () => {
    await inRollback(async (trx) => {
      const cache = new AiCompletionCache(trx);
      const gen = vi.fn().mockResolvedValue(generated());
      const res = await cache.getOrGenerate(LOOKUP, gen);
      expect(res.cached).toBe(false);
      expect(gen).toHaveBeenCalledTimes(1);
      expect(res.output.output).toEqual({ tldr: 'raises reserve factor' });
      const cost = await trx
        .selectFrom('ai_cost_log')
        .selectAll()
        .where('feature_name', '=', 'test_summarizer')
        .executeTakeFirstOrThrow();
      expect(cost.input_tokens).toBe(1000);
      expect(cost.entity_reference).toBe('compound:42');
    });
  });

  it('hit: returns the stored output and NEVER calls generate (no API call)', async () => {
    await inRollback(async (trx) => {
      const cache = new AiCompletionCache(trx);
      await cache.getOrGenerate(LOOKUP, vi.fn().mockResolvedValue(generated()));
      const gen2 = vi.fn().mockResolvedValue(generated({ output: { tldr: 'SHOULD NOT APPEAR' } }));
      const res = await cache.getOrGenerate(LOOKUP, gen2);
      expect(res.cached).toBe(true);
      expect(gen2).not.toHaveBeenCalled(); // the "no API call" property
      expect(res.output.output).toEqual({ tldr: 'raises reserve factor' });
    });
  });

  it('a changed input_hash misses and regenerates', async () => {
    await inRollback(async (trx) => {
      const cache = new AiCompletionCache(trx);
      await cache.getOrGenerate(LOOKUP, vi.fn().mockResolvedValue(generated()));
      const gen = vi.fn().mockResolvedValue(generated({ output: { tldr: 'new input' } }));
      const res = await cache.getOrGenerate({ ...LOOKUP, inputHash: 'sha256:ddd' }, gen);
      expect(res.cached).toBe(false);
      expect(gen).toHaveBeenCalledTimes(1);
      expect(res.output.output).toEqual({ tldr: 'new input' });
    });
  });

  it('if generate throws, nothing is written', async () => {
    await inRollback(async (trx) => {
      const cache = new AiCompletionCache(trx);
      await expect(
        cache.getOrGenerate(LOOKUP, () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
      const n = await trx
        .selectFrom('ai_output')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('feature_name', '=', 'test_summarizer')
        .executeTakeFirstOrThrow();
      expect(Number(n.n)).toBe(0);
    });
  });
});
