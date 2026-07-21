import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type {
  BatchHandle,
  FacadeBatchItem,
  LLMClient,
  ProviderBatchResult,
  RenderedPrompt,
} from '@libs/ai';
import { ProposalSummaryBatchService } from './proposal-summary-batch.service';
import { aiMetrics } from '../metrics/ai-metrics';

// A minimal proposal the fake scan returns; only fields the service touches matter.
const PROPOSAL = { id: 'prop-1', dao_id: 'dao-1', description: 'body', binding: true } as never;

const SCHEMA = z.object({ tldr: z.string() });
function rendered(): RenderedPrompt<{ tldr: string }> {
  return {
    feature: 'proposal_summarizer',
    promptVersion: 'v1.0',
    model: 'claude-haiku-4-5',
    schema: SCHEMA,
    messages: [{ role: 'user', content: 'summarize' }],
    inputContent: JSON.stringify({ decoded_actions: '[]', description: 'body' }),
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
  candidates?: unknown[];
  existingOutput?: boolean;
  fetches?: ProviderBatchResult[];
  enabled?: boolean;
  disabled?: boolean;
}) {
  const persist = vi.fn(async () => {});
  const dlqInsert = vi.fn(async () => {});
  const costsInsert = vi.fn(async () => {});
  const llm = new FakeLlm(over.fetches ?? []);
  const service = new ProposalSummaryBatchService(
    llm,
    { findSummaryCandidates: async () => over.candidates ?? [] } as never,
    {
      assemble: async () => ({
        rendered: rendered(),
        ctx: { daoId: 'dao-1', entityReference: 'proposal:prop-1' },
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

describe('ProposalSummaryBatchService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('inert when the feature is disabled by trigger flag', async () => {
    const { service, llm } = deps({ enabled: false, candidates: [PROPOSAL] });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('inert when the budget cap disabled the feature', async () => {
    const { service, llm } = deps({ disabled: true, candidates: [PROPOSAL] });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('submits a batch for an uncached candidate, then persists on the ended poll', async () => {
    const { service, llm, persist, costsInsert } = deps({
      candidates: [PROPOSAL],
      fetches: [
        { status: 'in_progress', results: [] },
        {
          status: 'ended',
          results: [
            {
              customId: 'proposal:prop-1',
              parsed: { tldr: 'ok' },
              cost: { totalUsd: 0.002, inputTokens: 100, outputTokens: 20 },
            },
          ],
        },
      ],
    });
    const tokens = vi.spyOn(aiMetrics.tokensTotal, 'add');

    await service.tick(); // submit
    expect(llm.submitBatch).toHaveBeenCalledOnce();
    const items = llm.submitBatch.mock.calls[0]![0] as FacadeBatchItem<unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]!.customId).toBe('proposal:prop-1');

    await service.tick(); // poll → in_progress → no write
    expect(persist).not.toHaveBeenCalled();

    await service.tick(); // poll → ended → persist
    expect(persist).toHaveBeenCalledOnce();
    expect(tokens).toHaveBeenCalledWith(100, { feature: 'proposal_summarizer', kind: 'input' });
    expect(tokens).toHaveBeenCalledWith(20, { feature: 'proposal_summarizer', kind: 'output' });
    expect(costsInsert).not.toHaveBeenCalled();
  });

  it('skips an already-cached candidate and never submits', async () => {
    const hits = vi.spyOn(aiMetrics.cacheHitsTotal, 'add');
    const { service, llm } = deps({ candidates: [PROPOSAL], existingOutput: true });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(hits).toHaveBeenCalledWith(1, { feature: 'proposal_summarizer' });
  });

  it('clears inFlight and stays live when one result throws during processing', async () => {
    const persist = vi.fn(async () => {
      throw new Error('persist boom');
    });
    const dlqInsert = vi.fn(async () => {});
    const costsInsert = vi.fn(async () => {});
    const llm = new FakeLlm([
      {
        status: 'ended',
        results: [
          {
            customId: 'proposal:prop-1',
            parsed: { tldr: 'ok' },
            cost: { totalUsd: 0.002, inputTokens: 100, outputTokens: 20 },
          },
        ],
      },
    ]);
    const service = new ProposalSummaryBatchService(
      llm,
      { findSummaryCandidates: async () => [PROPOSAL] } as never,
      {
        assemble: async () => ({
          rendered: rendered(),
          ctx: { daoId: 'dao-1', entityReference: 'proposal:prop-1' },
        }),
      } as never,
      { find: async () => undefined } as never,
      { persist } as never,
      { insert: dlqInsert } as never,
      { isEnabled: () => true } as never,
      { isDisabled: () => false } as never,
      { insert: costsInsert } as never,
    );

    await service.tick(); // submit
    expect(llm.submitBatch).toHaveBeenCalledOnce();

    await expect(service.tick()).resolves.toBeUndefined(); // poll → ended → persist throws, must not propagate
    expect(persist).toHaveBeenCalledOnce();

    // inFlight must have been cleared despite the failing result: a follow-up tick submits again.
    await service.tick();
    expect(llm.submitBatch).toHaveBeenCalledTimes(2);
  });

  it('dead-letters a schema-violating result instead of persisting', async () => {
    const { service, persist, dlqInsert, costsInsert } = deps({
      candidates: [PROPOSAL],
      fetches: [
        {
          status: 'ended',
          results: [
            {
              customId: 'proposal:prop-1',
              parsed: { not_tldr: 1 },
              cost: { totalUsd: 0.002, inputTokens: 100, outputTokens: 20 },
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
    expect(costsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        feature_name: 'proposal_summarizer',
        input_tokens: 100,
        output_tokens: 20,
      }),
    );
  });
});
