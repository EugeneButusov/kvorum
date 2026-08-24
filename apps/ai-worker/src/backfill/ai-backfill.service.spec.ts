import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { BatchHandle, FacadeBatchItem, LLMClient, ProviderBatchResult } from '@libs/ai';
import { AiBackfillService } from './ai-backfill.service';

const SCHEMA = z.object({ tldr: z.string() });
function rendered() {
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
  constructor(fetches: ProviderBatchResult[]) {
    this.fetchBatch = vi.fn(async () => fetches.shift() ?? { status: 'ended', results: [] });
  }
}

interface Over {
  features?: Record<string, boolean>;
  summaryPages?: unknown[][];
  mismatchPages?: unknown[][];
  existingOutput?: boolean;
  fetches?: ProviderBatchResult[];
  disabled?: boolean;
  daoSlugs?: string[];
  pageSize?: number;
}

function makeService(over: Over) {
  const llm = new FakeLlm(over.fetches ?? []);
  const persist = vi.fn(async () => {});
  const queueSend = vi.fn(async () => 'job-1');

  const summaryScan = vi.fn(async () => (over.summaryPages ?? []).shift() ?? []);
  const mismatchScan = vi.fn(async () => (over.mismatchPages ?? []).shift() ?? []);
  const embeddingScan = vi.fn(async () => []);

  const config = {
    isEnabled: () => over.features === undefined || Object.values(over.features).some(Boolean),
    isFeatureEnabled: (f: string) => over.features?.[f] ?? false,
    daoSlugs: () => over.daoSlugs ?? [],
    pageSize: () => over.pageSize ?? 100,
  };

  const service = new AiBackfillService(
    llm,
    { send: queueSend } as never,
    { findAllForBackfill: summaryScan } as never,
    { findAllForBackfill: mismatchScan } as never,
    { findAllForBackfill: embeddingScan } as never,
    { getThreadById: async () => undefined } as never, // forum unused in these tests
    {
      assemble: async () => ({
        rendered: rendered(),
        ctx: { daoId: 'dao-1', entityReference: 'proposal:prop-1' },
      }),
    } as never,
    { assemble: () => ({ rendered: rendered(), ctx: {}, rawContent: 'x' }) } as never,
    { find: async () => (over.existingOutput ? ({ id: 'o1' } as never) : undefined) } as never,
    { persist } as never,
    { insert: vi.fn() } as never,
    { insert: vi.fn() } as never,
    { isDisabled: () => over.disabled ?? false } as never,
    config as never,
  );
  return { service, llm, persist, queueSend, summaryScan, mismatchScan };
}

describe('AiBackfillService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('is fully inert when AI_BACKFILL_ENABLED / all feature flags are off', async () => {
    const { service, llm, queueSend } = makeService({
      features: {},
      summaryPages: [[{ id: 'p1' }]],
    });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it('advances the cursor past an all-cache-hit page WITHOUT submitting (anti-stall)', async () => {
    const { service, llm, summaryScan } = makeService({
      features: { proposal_summarizer: true },
      existingOutput: true, // every candidate is already cached
      summaryPages: [[{ id: 'p1' }, { id: 'p2' }], []], // page 1, then drained
    });
    await service.tick(); // page 1: all cache-hits → no submit, cursor → 'p2'
    expect(llm.submitBatch).not.toHaveBeenCalled();
    await service.tick(); // next page scanned from the advanced cursor
    expect(summaryScan).toHaveBeenCalledTimes(2);
    expect(summaryScan.mock.calls[0]![0]).toBeNull(); // first page: cursor null
    expect(summaryScan.mock.calls[1]![0]).toBe('p2'); // second page: advanced past the cached page
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('summary batch: submits an uncached page, then persists on the ended poll; cursor advances', async () => {
    const { service, llm, persist, summaryScan } = makeService({
      features: { proposal_summarizer: true },
      summaryPages: [[{ id: 'prop-1' }], []],
      fetches: [
        {
          status: 'ended',
          results: [
            {
              customId: 'proposal_prop-1',
              parsed: { tldr: 'ok' },
              cost: { totalUsd: 0.002, inputTokens: 100, outputTokens: 20 },
            },
          ],
        },
      ],
    });
    await service.tick(); // submit
    expect(llm.submitBatch).toHaveBeenCalledOnce();
    await service.tick(); // poll → ended → persist, cursor → 'prop-1'
    expect(persist).toHaveBeenCalledOnce();
    await service.tick(); // idle → next page scanned from advanced cursor
    expect(summaryScan.mock.calls.at(-1)![0]).toBe('prop-1');
  });

  it('drains an in-flight batch even after the budget cap trips (capture what we paid for)', async () => {
    const { service, llm, persist } = makeService({
      features: { proposal_summarizer: true },
      summaryPages: [[{ id: 'prop-1' }]],
      fetches: [
        {
          status: 'ended',
          results: [
            {
              customId: 'proposal_prop-1',
              parsed: { tldr: 'ok' },
              cost: { totalUsd: 0.002, inputTokens: 100, outputTokens: 20 },
            },
          ],
        },
      ],
    });
    await service.tick(); // submit (budget enabled)
    expect(llm.submitBatch).toHaveBeenCalledOnce();
    // Cap trips mid-flight → still drain the batch we already paid for.
    (service as unknown as { budget: { isDisabled: () => boolean } }).budget.isDisabled = () =>
      true;
    await service.tick();
    expect(persist).toHaveBeenCalledOnce();
  });

  it('sync feature (mismatch): enqueues one job per row with the right singletonKey; cursor advances', async () => {
    const { service, queueSend, mismatchScan } = makeService({
      features: { mismatch_detector: true },
      mismatchPages: [[{ id: 'm1' }, { id: 'm2' }], []],
    });
    await service.tick();
    expect(queueSend).toHaveBeenCalledTimes(2);
    expect(queueSend.mock.calls[0]![0]).toBe('ai_mismatch');
    expect(queueSend.mock.calls[0]![1]).toEqual({
      feature: 'mismatch_detector',
      entityRef: 'proposal:m1',
    });
    expect(queueSend.mock.calls[0]![2]).toMatchObject({
      singletonKey: 'mismatch_detector:proposal:m1',
    });
    await service.tick(); // next page from advanced cursor
    expect(mismatchScan.mock.calls.at(-1)![0]).toBe('m2');
  });

  it('sync feature does not enqueue when the budget cap disabled it', async () => {
    const { service, queueSend } = makeService({
      features: { mismatch_detector: true },
      mismatchPages: [[{ id: 'm1' }]],
      disabled: true,
    });
    await service.tick();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it('threads the configured DAO scope into the scan', async () => {
    const { service, summaryScan } = makeService({
      features: { proposal_summarizer: true },
      summaryPages: [[]],
      daoSlugs: ['compound', 'aave', 'lido'],
      pageSize: 250,
    });
    await service.tick();
    expect(summaryScan).toHaveBeenCalledWith(null, 250, ['compound', 'aave', 'lido']);
  });
});
