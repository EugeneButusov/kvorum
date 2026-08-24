import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FORUM_MODEL_HAIKU } from '@libs/ai';
import type {
  BatchHandle,
  FacadeBatchItem,
  LLMClient,
  ProviderBatchResult,
  RenderedPrompt,
} from '@libs/ai';
import type { ForumThreadForSynthesis } from '@sources/forum';
import { ForumSynthesisBatchService } from './forum-synthesis-batch.service';
import { aiMetrics } from '../metrics/ai-metrics';

const ENGLISH =
  'Everyone supports this proposal. It is a clear benefit and we all agree it passes.';
const CHINESE = '这是一个完全由中文写成的治理讨论帖，没有任何英文内容，完全无法被合成。';

const SCHEMA = z.object({ sentiment: z.string() });
function rendered(): RenderedPrompt<{ sentiment: string }> {
  return {
    feature: 'forum_synthesizer',
    promptVersion: 'v1.0',
    model: FORUM_MODEL_HAIKU,
    schema: SCHEMA,
    messages: [{ role: 'user', content: 'synthesize' }],
    inputContent: 'ignored — the service overrides with raw_content',
  };
}

function thread(over: Partial<ForumThreadForSynthesis> = {}): ForumThreadForSynthesis {
  return {
    id: 't1',
    daoId: 'dao-1',
    daoSlug: 'compound',
    daoName: 'Compound',
    threadTitle: 'Thread',
    rawContent: ENGLISH,
    linkedProposalTitle: 'Raise reserve factor',
    linkedProposalState: 'active',
    linkedProposalVotingEndsAt: null,
    ...over,
  };
}

class FakeLlm implements LLMClient {
  complete = vi.fn();
  embed = vi.fn();
  submitBatch = vi.fn(
    async (_items: FacadeBatchItem<unknown>[]): Promise<BatchHandle> => ({
      id: 'batch-1',
      provider: 'fake',
    }),
  );
  fetchBatch: (h: BatchHandle) => Promise<ProviderBatchResult>;
  constructor(private readonly fetches: ProviderBatchResult[]) {
    this.fetchBatch = vi.fn(async () => this.fetches.shift() ?? { status: 'ended', results: [] });
  }
}

function deps(over: {
  candidateThread?: ForumThreadForSynthesis;
  closedIds?: string[];
  existingOutput?: boolean;
  fetches?: ProviderBatchResult[];
  enabled?: boolean;
  disabled?: boolean;
}) {
  const persist = vi.fn(async () => {});
  const dlqInsert = vi.fn(async () => {});
  const costsInsert = vi.fn(async () => {});
  const t = over.candidateThread ?? thread();
  const llm = new FakeLlm(over.fetches ?? []);
  const service = new ForumSynthesisBatchService(
    llm,
    {
      findSynthesisCandidates: async () => [{ id: t.id }],
      findRecentlyClosedSynthesisCandidates: async () =>
        (over.closedIds ?? []).map((id) => ({ id })),
      getThreadById: async () => t,
    } as never,
    {
      assemble: (th: ForumThreadForSynthesis) => ({
        rendered: rendered(),
        ctx: { daoId: th.daoId, entityReference: `forum_thread:${th.id}` },
        rawContent: th.rawContent ?? '',
      }),
    } as never,
    { find: async () => (over.existingOutput ? ({ id: 'o1' } as never) : undefined) } as never,
    { persist } as never,
    { insert: dlqInsert } as never,
    { isEnabled: () => over.enabled ?? true } as never,
    { isDisabled: () => over.disabled ?? false } as never,
    { insert: costsInsert } as never,
  );
  return { service, llm, persist, dlqInsert, costsInsert };
}

describe('ForumSynthesisBatchService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('inert when the feature is disabled by the trigger flag', async () => {
    const { service, llm } = deps({ enabled: false });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('inert when the budget cap disabled the feature', async () => {
    const { service, llm } = deps({ disabled: true });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('submits a forum-thread batch item and persists on the ended poll', async () => {
    const { service, llm, persist } = deps({
      fetches: [
        { status: 'in_progress', results: [] },
        {
          status: 'ended',
          results: [
            {
              customId: 'forum_thread_t1',
              parsed: { sentiment: 'mixed' },
              cost: { totalUsd: 0.0025, inputTokens: 15000, outputTokens: 1000 },
            },
          ],
        },
      ],
    });

    await service.tick(); // submit
    expect(llm.submitBatch).toHaveBeenCalledOnce();
    const items = llm.submitBatch.mock.calls[0]![0] as FacadeBatchItem<unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]!.customId).toBe('forum_thread_t1');
    expect(items[0]!.request).toMatchObject({ mode: 'batch', routingReason: 'short' });

    await service.tick(); // poll → in_progress → no write
    expect(persist).not.toHaveBeenCalled();

    await service.tick(); // poll → ended → persist
    expect(persist).toHaveBeenCalledOnce();
  });

  it('skips an already-cached thread and never submits', async () => {
    const hits = vi.spyOn(aiMetrics.cacheHitsTotal, 'add');
    const { service, llm } = deps({ existingOutput: true });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(hits).toHaveBeenCalledWith(1, { feature: 'forum_synthesizer' });
  });

  it('persists a skip marker for a non-English thread and never submits it', async () => {
    const { service, llm, persist } = deps({ candidateThread: thread({ rawContent: CHINESE }) });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledOnce();
    const [, result] = persist.mock.calls[0]!;
    expect(result.output).toEqual({ _meta: { skipped_reason: 'non_english' } });
  });

  it('dead-letters a schema-violating batch result instead of persisting', async () => {
    const { service, persist, dlqInsert, costsInsert } = deps({
      fetches: [
        {
          status: 'ended',
          results: [
            {
              customId: 'forum_thread_t1',
              parsed: { not_sentiment: 1 },
              cost: { totalUsd: 0.0025, inputTokens: 15000, outputTokens: 1000 },
            },
          ],
        },
      ],
    });
    await service.tick(); // submit
    await service.tick(); // poll → ended → invalid → DLQ
    expect(dlqInsert).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
    expect(costsInsert).toHaveBeenCalledOnce();
  });
});
