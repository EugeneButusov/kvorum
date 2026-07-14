import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pgDb } from '@libs/db';
import { AiCompletionCache, type CostContext } from './ai-completion-cache.js';
import type { CompletionRequest, CompletionResult, LLMClient } from '../llm/ports.js';

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

const schema = z.object({ tldr: z.string() });
const CTX: CostContext = { daoId: null, entityReference: 'compound:42' };

function req(
  overrides: Partial<CompletionRequest<{ tldr: string }>> = {},
): CompletionRequest<{ tldr: string }> {
  return {
    feature: 'test_summarizer',
    promptVersion: 'v1.0',
    model: 'claude-haiku-4-5',
    schema,
    messages: [{ role: 'user', content: 'summarize' }],
    mode: 'sync',
    inputContent: 'the proposal body',
    ...overrides,
  };
}

function result(output: { tldr: string }): CompletionResult<{ tldr: string }> {
  return {
    output,
    cost: { totalUsd: 0.002, inputTokens: 1000, outputTokens: 200 },
    provenance: {
      feature: 'test_summarizer',
      model: 'claude-haiku-4-5',
      promptVersion: 'v1.0',
      inputHash: 'sha256:unused-in-cache',
      generatedAt: '2026-07-10T00:00:00.000Z',
    },
  };
}

function fakeLlm(res: CompletionResult<{ tldr: string }>): {
  llm: LLMClient;
  complete: ReturnType<typeof vi.fn>;
} {
  const complete = vi.fn().mockResolvedValue(res);
  const llm = {
    complete,
    embed: vi.fn(),
    submitBatch: vi.fn(),
    fetchBatch: vi.fn(),
  } as unknown as LLMClient;
  return { llm, complete };
}

describeWithDb('AiCompletionCache.complete (integration)', () => {
  it('miss: calls the client once, writes ai_output + ai_cost_log', async () => {
    await inRollback(async (trx) => {
      const { llm, complete } = fakeLlm(result({ tldr: 'raises reserve factor' }));
      const res = await new AiCompletionCache(trx, llm).complete(req(), CTX);
      expect(res.cached).toBe(false);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(res.output).toEqual({ tldr: 'raises reserve factor' });
      const out = await trx
        .selectFrom('ai_output')
        .selectAll()
        .where('feature_name', '=', 'test_summarizer')
        .executeTakeFirstOrThrow();
      expect(out.output).toEqual({ tldr: 'raises reserve factor' });
      const cost = await trx
        .selectFrom('ai_cost_log')
        .selectAll()
        .where('feature_name', '=', 'test_summarizer')
        .executeTakeFirstOrThrow();
      expect(cost.input_tokens).toBe(1000);
      expect(cost.entity_reference).toBe('compound:42');
    });
  });

  it('hit: returns the stored output and NEVER calls the client (no API call)', async () => {
    await inRollback(async (trx) => {
      const first = fakeLlm(result({ tldr: 'raises reserve factor' }));
      await new AiCompletionCache(trx, first.llm).complete(req(), CTX);
      const second = fakeLlm(result({ tldr: 'SHOULD NOT APPEAR' }));
      const res = await new AiCompletionCache(trx, second.llm).complete(req(), CTX);
      expect(res.cached).toBe(true);
      expect(second.complete).not.toHaveBeenCalled();
      expect(res.output).toEqual({ tldr: 'raises reserve factor' });
    });
  });

  it('a changed inputContent (different hash) misses and regenerates', async () => {
    await inRollback(async (trx) => {
      await new AiCompletionCache(trx, fakeLlm(result({ tldr: 'first' })).llm).complete(req(), CTX);
      const { llm, complete } = fakeLlm(result({ tldr: 'new input' }));
      const res = await new AiCompletionCache(trx, llm).complete(
        req({ inputContent: 'a different body' }),
        CTX,
      );
      expect(res.cached).toBe(false);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(res.output).toEqual({ tldr: 'new input' });
    });
  });

  it('if the client throws, nothing is written', async () => {
    await inRollback(async (trx) => {
      const complete = vi.fn().mockRejectedValue(new Error('boom'));
      const llm = {
        complete,
        embed: vi.fn(),
        submitBatch: vi.fn(),
        fetchBatch: vi.fn(),
      } as unknown as LLMClient;
      await expect(new AiCompletionCache(trx, llm).complete(req(), CTX)).rejects.toThrow('boom');
      const n = await trx
        .selectFrom('ai_output')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('feature_name', '=', 'test_summarizer')
        .executeTakeFirstOrThrow();
      expect(Number(n.n)).toBe(0);
    });
  });
});

describeWithDb('AiCompletionCache.persist (integration)', () => {
  it('writes ai_output + ai_cost_log for a pre-computed result, no client call', async () => {
    await inRollback(async (trx) => {
      const { llm, complete } = fakeLlm(result({ tldr: 'batch-computed summary' }));
      await new AiCompletionCache(trx, llm).persist(
        req({ mode: 'batch' }),
        result({ tldr: 'batch-computed summary' }),
        CTX,
      );
      expect(complete).not.toHaveBeenCalled();
      const out = await trx
        .selectFrom('ai_output')
        .selectAll()
        .where('feature_name', '=', 'test_summarizer')
        .executeTakeFirstOrThrow();
      expect(out.output).toEqual({ tldr: 'batch-computed summary' });
      const cost = await trx
        .selectFrom('ai_cost_log')
        .selectAll()
        .where('feature_name', '=', 'test_summarizer')
        .executeTakeFirstOrThrow();
      expect(cost.output_tokens).toBe(200);
    });
  });

  it('is idempotent on the ai_output key: a second persist leaves one output row', async () => {
    await inRollback(async (trx) => {
      const cache = new AiCompletionCache(trx, fakeLlm(result({ tldr: 'once' })).llm);
      await cache.persist(req({ mode: 'batch' }), result({ tldr: 'once' }), CTX);
      await cache.persist(req({ mode: 'batch' }), result({ tldr: 'twice-ignored' }), CTX);
      const rows = await trx
        .selectFrom('ai_output')
        .selectAll()
        .where('feature_name', '=', 'test_summarizer')
        .execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.output).toEqual({ tldr: 'once' });
    });
  });
});
