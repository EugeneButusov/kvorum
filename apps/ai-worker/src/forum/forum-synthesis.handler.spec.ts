import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  FORUM_MODEL_HAIKU,
  FORUM_MODEL_SONNET,
  LlmSchemaViolationError,
  type CompletionResult,
  type RenderedPrompt,
} from '@libs/ai';
import type { ForumThreadForSynthesis } from '@sources/forum';
import { ForumSynthesisHandler } from './forum-synthesis.handler';
import { aiMetrics } from '../metrics/ai-metrics';

const SCHEMA = z.object({ sentiment: z.string() });

// A short, calm thread routes to Haiku; a polarized one routes to Sonnet (see forum-model-routing).
const CALM = 'Everyone supports this. It is a clear benefit and we all agree.';
const CONTENTIOUS =
  'I support this and agree it brings a clear benefit and advantage. However others oppose it, ' +
  'disagree, and reject it, citing serious risk, a design flaw, and an unacceptable downside.';

function rendered(): RenderedPrompt<{ sentiment: string }> {
  return {
    feature: 'forum_synthesizer',
    promptVersion: 'v1.0',
    model: FORUM_MODEL_HAIKU,
    schema: SCHEMA,
    messages: [{ role: 'user', content: 'synthesize' }],
    inputContent: 'ignored — handler overrides with raw_content',
  };
}

function completion(): CompletionResult<{ sentiment: string }> {
  return {
    output: { sentiment: 'mixed' },
    cost: { totalUsd: 0.005, inputTokens: 15000, outputTokens: 1000 },
    provenance: {
      feature: 'forum_synthesizer',
      model: FORUM_MODEL_HAIKU,
      promptVersion: 'v1.0',
      inputHash: 'sha256:x',
      generatedAt: '2026-06-01T12:00:00Z',
    },
  };
}

function violation(): LlmSchemaViolationError {
  return new LlmSchemaViolationError({
    feature: 'forum_synthesizer',
    promptVersion: 'v1.0',
    inputHash: 'sha256:x',
    model: FORUM_MODEL_HAIKU,
    rawOutput: { bad: 1 },
    zodError: SCHEMA.safeParse({}).error!,
    attempts: 2,
  });
}

function thread(over: Partial<ForumThreadForSynthesis> = {}): ForumThreadForSynthesis {
  return {
    id: 'thread-1',
    daoId: 'dao-1',
    daoSlug: 'compound',
    daoName: 'Compound',
    threadTitle: 'Thread',
    rawContent: CALM,
    linkedProposalTitle: 'Raise reserve factor',
    // Default: an active proposal with imminent voting → the sync handler runs (urgent path).
    linkedProposalState: 'active',
    linkedProposalVotingEndsAt: new Date(Date.now() + 60 * 60 * 1000),
    ...over,
  };
}

function deps(over: {
  thread?: ForumThreadForSynthesis | undefined;
  existingOutput?: boolean;
  enabled?: boolean;
  disabled?: boolean;
  complete?: () => Promise<CompletionResult<{ sentiment: string }>>;
}) {
  const complete = vi.fn(over.complete ?? (async () => completion()));
  const persist = vi.fn(async () => {});
  const dlqInsert = vi.fn(async () => {});
  const deleteByKey = vi.fn(async () => {});
  const register = vi.fn();
  const threadResult = 'thread' in over ? over.thread : thread();
  const handler = new ForumSynthesisHandler(
    { complete } as never,
    { getThreadById: async () => threadResult } as never,
    {
      assemble: (t: ForumThreadForSynthesis) => ({
        rendered: rendered(),
        ctx: { daoId: 'dao-1', entityReference: `forum_thread:${t.id}` },
        rawContent: t.rawContent ?? '',
      }),
    } as never,
    {
      find: async () => (over.existingOutput ? ({ id: 'o1' } as never) : undefined),
      deleteByKey,
    } as never,
    { persist } as never,
    { insert: dlqInsert } as never,
    { isEnabled: () => over.enabled ?? true } as never,
    { isDisabled: () => over.disabled ?? false } as never,
    { register } as never,
  );
  return { handler, complete, persist, dlqInsert, deleteByKey, register };
}

const JOB = { feature: 'forum_synthesizer', entityRef: 'forum_thread:thread-1' } as never;
const FORCE_JOB = {
  feature: 'forum_synthesizer',
  entityRef: 'forum_thread:thread-1',
  force: true,
} as never;

describe('ForumSynthesisHandler', () => {
  it('registers itself for the forum_synthesizer feature on module init', () => {
    const { handler, register } = deps({});
    handler.onModuleInit();
    expect(register).toHaveBeenCalledWith('forum_synthesizer', handler);
  });

  it('is inert when the feature is disabled by the trigger flag', async () => {
    const { handler, complete } = deps({ enabled: false });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('is inert when the budget cap disabled the feature', async () => {
    const { handler, complete } = deps({ disabled: true });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('skips when the thread is missing', async () => {
    const { handler, complete } = deps({ thread: undefined });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('skips a thread with no raw_content', async () => {
    const { handler, complete } = deps({ thread: thread({ rawContent: null }) });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('skips a thread not yet linked to a proposal', async () => {
    const { handler, complete } = deps({ thread: thread({ linkedProposalTitle: null }) });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('synchronously synthesizes + persists a linked, uncached thread', async () => {
    const tokens = vi.spyOn(aiMetrics.tokensTotal, 'add');
    const { handler, complete, persist } = deps({});
    await handler.handle(JOB);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]![0]).toMatchObject({ mode: 'sync' });
    expect(persist).toHaveBeenCalledOnce();
    expect(tokens).toHaveBeenCalledWith(15000, { feature: 'forum_synthesizer', kind: 'input' });
    expect(tokens).toHaveBeenCalledWith(1000, { feature: 'forum_synthesizer', kind: 'output' });
  });

  it('routes a calm thread to Haiku and a contentious thread to Sonnet', async () => {
    const calm = deps({});
    await calm.handler.handle(JOB);
    expect(calm.complete.mock.calls[0]![0]).toMatchObject({ model: FORUM_MODEL_HAIKU });

    const hot = deps({ thread: thread({ rawContent: CONTENTIOUS }) });
    await hot.handler.handle(JOB);
    expect(hot.complete.mock.calls[0]![0]).toMatchObject({ model: FORUM_MODEL_SONNET });
  });

  it('stamps the routing reason on the request so it lands in provenance (SPEC §5.7)', async () => {
    const calm = deps({});
    await calm.handler.handle(JOB);
    expect(calm.complete.mock.calls[0]![0]).toMatchObject({ routingReason: 'short' });

    const hot = deps({ thread: thread({ rawContent: CONTENTIOUS }) });
    await hot.handler.handle(JOB);
    expect(hot.complete.mock.calls[0]![0]).toMatchObject({ routingReason: 'contentious' });
  });

  it('acks without synthesizing when the thread is not urgent and not forced (batch handles it)', async () => {
    const { handler, complete } = deps({
      thread: thread({ linkedProposalState: 'succeeded', linkedProposalVotingEndsAt: null }),
    });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('acks when the linked proposal is active but voting is not imminent', async () => {
    const { handler, complete } = deps({
      thread: thread({
        linkedProposalVotingEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('forces a synchronous synthesis for a non-urgent thread, clearing the cache first', async () => {
    const { handler, complete, deleteByKey } = deps({
      thread: thread({ linkedProposalState: 'succeeded', linkedProposalVotingEndsAt: null }),
    });
    await handler.handle(FORCE_JOB);
    expect(deleteByKey).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });

  it('forced refresh re-runs even when a cached output exists (no cache-hit short-circuit)', async () => {
    const { handler, complete } = deps({ existingOutput: true });
    await handler.handle(FORCE_JOB);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('skips a non-English thread: persists a skip marker with no LLM call', async () => {
    const chinese = '你好，世界。这是一条测试消息。';
    const { handler, complete, persist } = deps({ thread: thread({ rawContent: chinese }) });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledOnce();
    const [req, result] = persist.mock.calls[0]!;
    expect(result.output).toEqual({ _meta: { skipped_reason: 'non_english' } });
    expect(result.cost).toEqual({ totalUsd: 0, inputTokens: 0, outputTokens: 0 });
    expect(req.model).toBe('none');
  });

  it('skips an already-synthesized thread (cache hit)', async () => {
    const hits = vi.spyOn(aiMetrics.cacheHitsTotal, 'add');
    const { handler, complete } = deps({ existingOutput: true });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
    expect(hits).toHaveBeenCalledWith(1, { feature: 'forum_synthesizer' });
  });

  it('dead-letters a schema violation and acks (no rethrow, no persist)', async () => {
    const { handler, persist, dlqInsert } = deps({
      complete: async () => {
        throw violation();
      },
    });
    await expect(handler.handle(JOB)).resolves.toBeUndefined();
    expect(dlqInsert).toHaveBeenCalledOnce();
    expect(dlqInsert).toHaveBeenCalledWith(
      expect.objectContaining({ feature_name: 'forum_synthesizer', attempts: 2 }),
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('rethrows a transient (non-schema) error so the job retries', async () => {
    const { handler, dlqInsert } = deps({
      complete: async () => {
        throw new Error('rate limited');
      },
    });
    await expect(handler.handle(JOB)).rejects.toThrow('rate limited');
    expect(dlqInsert).not.toHaveBeenCalled();
  });
});
