import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { BatchHandle, FacadeBatchItem, LLMClient, RenderedPrompt } from '@libs/ai';
import { ProposalSummaryBatchService } from './proposal-summary-batch.service';
import type { DurableBatch, PollOutcome } from '../batch/durable-batch';
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
  fetchBatch = vi.fn(async () => ({ status: 'ended' as const, results: [] }));
}

/** The service now delegates all in-flight/persist bookkeeping to DurableBatch; the driver's job is
 *  poll → (if idle) scan + submit + record. This double scripts the poll outcome and captures record. */
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
  candidates?: unknown[];
  existingOutput?: boolean;
  poll?: PollOutcome[];
  enabled?: boolean;
  disabled?: boolean;
}) {
  const llm = new FakeLlm();
  const durable = fakeDurable(over.poll);
  const service = new ProposalSummaryBatchService(
    llm,
    { findCandidates: async () => over.candidates ?? [] } as never,
    {
      assemble: async () => ({
        rendered: rendered(),
        ctx: { daoId: 'dao-1', entityReference: 'proposal:prop-1' },
      }),
    } as never,
    { find: async () => (over.existingOutput ? ({ id: 'o1' } as never) : undefined) } as never,
    durable,
    { isEnabled: () => over.enabled ?? true } as never,
    { isDisabled: () => over.disabled ?? false } as never,
  );
  return { service, llm, durable };
}

describe('ProposalSummaryBatchService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('inert when the feature is disabled by trigger flag', async () => {
    const { service, llm, durable } = deps({ enabled: false, candidates: [PROPOSAL] });
    await service.tick();
    expect(durable.pollOpen).not.toHaveBeenCalled();
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('inert when the budget cap disabled the feature', async () => {
    const { service, llm, durable } = deps({ disabled: true, candidates: [PROPOSAL] });
    await service.tick();
    expect(durable.pollOpen).not.toHaveBeenCalled();
    expect(llm.submitBatch).not.toHaveBeenCalled();
  });

  it('submits an uncached candidate and records it durably when idle', async () => {
    const { service, llm, durable } = deps({ candidates: [PROPOSAL], poll: [{ state: 'idle' }] });
    await service.tick();
    expect(llm.submitBatch).toHaveBeenCalledOnce();
    const items = llm.submitBatch.mock.calls[0]![0] as FacadeBatchItem<unknown>[];
    expect(items[0]!.customId).toBe('proposal_prop-1');
    // recorded as durable in-flight state: (feature, handle, descriptors, pendingCursor=null)
    expect(durable.record).toHaveBeenCalledOnce();
    const [feature, handle, descriptors, cursor] = durable.record.mock.calls[0]!;
    expect(feature).toBe('proposal_summarizer');
    expect(handle).toEqual({ id: 'batch-1', provider: 'fake' });
    expect(descriptors[0].customId).toBe('proposal_prop-1');
    expect(descriptors[0].inputHash).toMatch(/^sha256:/);
    expect(cursor).toBeNull();
  });

  it('does not submit while a batch is still in flight', async () => {
    const { service, llm, durable } = deps({
      candidates: [PROPOSAL],
      poll: [{ state: 'waiting' }],
    });
    await service.tick();
    expect(durable.pollOpen).toHaveBeenCalledOnce();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(durable.record).not.toHaveBeenCalled();
  });

  it('skips an already-cached candidate and never submits', async () => {
    const hits = vi.spyOn(aiMetrics.cacheHitsTotal, 'add');
    const { service, llm, durable } = deps({ candidates: [PROPOSAL], existingOutput: true });
    await service.tick();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(durable.record).not.toHaveBeenCalled();
    expect(hits).toHaveBeenCalledWith(1, { feature: 'proposal_summarizer' });
  });
});
