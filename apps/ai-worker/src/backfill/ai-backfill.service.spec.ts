import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { BatchHandle, FacadeBatchItem, LLMClient } from '@libs/ai';
import { AiBackfillService } from './ai-backfill.service';
import type { DurableBatch, PollOutcome } from '../batch/durable-batch';

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
  fetchBatch = vi.fn(async () => ({ status: 'ended' as const, results: [] }));
}

/** Stateful DurableBatch double: cursors persist across ticks (so cursor threading is observable);
 *  pollOpen is scriptable per batch-feature tick; record captures submitted descriptors. */
function fakeDurable(poll: PollOutcome[] = []) {
  const cursors = new Map<string, string>();
  const pollQueue = [...poll];
  return {
    pollOpen: vi.fn(async (_feature: string) => pollQueue.shift() ?? { state: 'idle' }),
    record: vi.fn(async () => {}),
    getCursor: vi.fn(async (feature: string) => cursors.get(feature) ?? null),
    advanceCursor: vi.fn(async (feature: string, cursor: string) => {
      cursors.set(feature, cursor);
    }),
  } as unknown as DurableBatch & {
    pollOpen: ReturnType<typeof vi.fn>;
    record: ReturnType<typeof vi.fn>;
    getCursor: ReturnType<typeof vi.fn>;
    advanceCursor: ReturnType<typeof vi.fn>;
  };
}

interface Over {
  features?: Record<string, boolean>;
  summaryPages?: unknown[][];
  mismatchPages?: unknown[][];
  existingOutput?: boolean;
  poll?: PollOutcome[];
  disabled?: boolean;
  daoSlugs?: string[];
  pageSize?: number;
}

function makeService(over: Over) {
  const llm = new FakeLlm();
  const queueSend = vi.fn(async () => 'job-1');
  const durable = fakeDurable(over.poll);

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
    { persist: vi.fn() } as never,
    durable,
    { isDisabled: () => over.disabled ?? false } as never,
    config as never,
  );
  return { service, llm, queueSend, summaryScan, mismatchScan, durable };
}

describe('AiBackfillService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('is fully inert when AI_BACKFILL_ENABLED / all feature flags are off', async () => {
    const { service, llm, queueSend, durable } = makeService({
      features: {},
      summaryPages: [[{ id: 'p1' }]],
    });
    await service.tick();
    expect(durable.pollOpen).not.toHaveBeenCalled();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it('advances the durable cursor past an all-cache-hit page WITHOUT submitting (anti-stall)', async () => {
    const { service, llm, summaryScan, durable } = makeService({
      features: { proposal_summarizer: true },
      existingOutput: true, // every candidate is already cached
      summaryPages: [[{ id: 'p1' }, { id: 'p2' }], []],
    });
    await service.tick(); // page 1: all cache-hits → no submit, durable cursor → 'p2'
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(durable.advanceCursor).toHaveBeenCalledWith('proposal_summarizer', 'p2');
    await service.tick(); // next page scanned from the advanced cursor
    expect(summaryScan.mock.calls[0]![0]).toBeNull(); // first page: cursor null
    expect(summaryScan.mock.calls[1]![0]).toBe('p2'); // second page: advanced past the cached page
  });

  it('submits an uncached page and records it durably (pending cursor = page end)', async () => {
    const { service, llm, durable } = makeService({
      features: { proposal_summarizer: true },
      summaryPages: [[{ id: 'prop-1' }]],
    });
    await service.tick();
    expect(llm.submitBatch).toHaveBeenCalledOnce();
    expect(durable.record).toHaveBeenCalledOnce();
    const [feature, handle, descriptors, cursor] = durable.record.mock.calls[0]!;
    expect(feature).toBe('proposal_summarizer');
    expect(handle).toEqual({ id: 'batch-1', provider: 'fake' });
    expect(descriptors[0].customId).toBe('proposal_prop-1');
    expect(cursor).toBe('prop-1'); // committed once the batch drains
  });

  it('does not submit a new page while a batch is still in flight', async () => {
    const { service, llm, durable } = makeService({
      features: { proposal_summarizer: true },
      summaryPages: [[{ id: 'prop-1' }]],
      poll: [{ state: 'waiting' }],
    });
    await service.tick();
    expect(durable.pollOpen).toHaveBeenCalledOnce();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(durable.record).not.toHaveBeenCalled();
  });

  it('polls/drains the in-flight batch even when the budget cap is disabled', async () => {
    // pollOpen runs before the budget gate, so a paid in-flight batch is always drained; only NEW
    // submits are paused by the cap.
    const { service, llm, durable } = makeService({
      features: { proposal_summarizer: true },
      summaryPages: [[{ id: 'prop-1' }]],
      disabled: true,
      poll: [{ state: 'waiting' }],
    });
    await service.tick();
    expect(durable.pollOpen).toHaveBeenCalledOnce();
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('sync feature (mismatch): enqueues one job per row with the right singletonKey; cursor advances', async () => {
    const { service, queueSend, mismatchScan, durable } = makeService({
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
    expect(durable.advanceCursor).toHaveBeenCalledWith('mismatch_detector', 'm2');
    await service.tick(); // next page from the advanced durable cursor
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
