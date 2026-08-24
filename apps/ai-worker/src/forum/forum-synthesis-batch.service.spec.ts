import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FORUM_MODEL_HAIKU } from '@libs/ai';
import type { BatchHandle, FacadeBatchItem, LLMClient, RenderedPrompt } from '@libs/ai';
import type { ForumThreadForSynthesis } from '@sources/forum';
import { ForumSynthesisBatchService } from './forum-synthesis-batch.service';
import type { DurableBatch, PollOutcome } from '../batch/durable-batch';
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
  fetchBatch = vi.fn(async () => ({ status: 'ended' as const, results: [] }));
}

function fakeDurable(poll: PollOutcome[] = [{ state: 'idle' }]) {
  const queue = [...poll];
  return {
    pollOpen: vi.fn(async () => queue.shift() ?? { state: 'idle' }),
    record: vi.fn(async () => {}),
    getCursor: vi.fn(async () => null),
    advanceCursor: vi.fn(async () => {}),
  } as unknown as DurableBatch & {
    pollOpen: ReturnType<typeof vi.fn>;
    record: ReturnType<typeof vi.fn>;
  };
}

function deps(over: {
  candidateThread?: ForumThreadForSynthesis;
  closedIds?: string[];
  existingOutput?: boolean;
  poll?: PollOutcome[];
  enabled?: boolean;
  disabled?: boolean;
}) {
  const persist = vi.fn(async () => {}); // the non-English skip path still writes via AiCompletionCache
  const t = over.candidateThread ?? thread();
  const llm = new FakeLlm();
  const durable = fakeDurable(over.poll);
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
    durable,
    { isEnabled: () => over.enabled ?? true } as never,
    { isDisabled: () => over.disabled ?? false } as never,
  );
  return { service, llm, durable, persist };
}

describe('ForumSynthesisBatchService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('inert when the feature is disabled by the trigger flag', async () => {
    const { service, llm, durable } = deps({ enabled: false });
    await service.tick();
    expect(durable.pollOpen).not.toHaveBeenCalled();
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('inert when the budget cap disabled the feature', async () => {
    const { service, llm, durable } = deps({ disabled: true });
    await service.tick();
    expect(durable.pollOpen).not.toHaveBeenCalled();
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('submits a forum-thread batch item and records it durably when idle', async () => {
    const { service, llm, durable } = deps({ poll: [{ state: 'idle' }] });
    await service.tick();
    expect(llm.submitBatch).toHaveBeenCalledOnce();
    const items = llm.submitBatch.mock.calls[0]![0] as FacadeBatchItem<unknown>[];
    expect(items[0]!.customId).toBe('forum_thread_t1');
    expect(items[0]!.request).toMatchObject({ mode: 'batch', routingReason: 'short' });
    expect(durable.record).toHaveBeenCalledOnce();
    const [feature, , descriptors, cursor] = durable.record.mock.calls[0]!;
    expect(feature).toBe('forum_synthesizer');
    expect(descriptors[0].customId).toBe('forum_thread_t1');
    expect(descriptors[0].routingReason).toBe('short');
    expect(cursor).toBeNull();
  });

  it('does not submit while a batch is still in flight', async () => {
    const { service, llm, durable } = deps({ poll: [{ state: 'waiting' }] });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(durable.record).not.toHaveBeenCalled();
  });

  it('skips an already-cached thread and never submits', async () => {
    const hits = vi.spyOn(aiMetrics.cacheHitsTotal, 'add');
    const { service, llm, durable } = deps({ existingOutput: true });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(durable.record).not.toHaveBeenCalled();
    expect(hits).toHaveBeenCalledWith(1, { feature: 'forum_synthesizer' });
  });

  it('persists a skip marker for a non-English thread and never submits it', async () => {
    const { service, llm, durable, persist } = deps({
      candidateThread: thread({ rawContent: CHINESE }),
    });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(durable.record).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledOnce();
    const [, result] = persist.mock.calls[0]!;
    expect(result.output).toEqual({ _meta: { skipped_reason: 'non_english' } });
  });
});
