import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmSchemaViolationError, type CompletionResult, type RenderedPrompt } from '@libs/ai';
import { ProposalSummaryHandler } from './proposal-summary.handler';
import { aiMetrics } from '../metrics/ai-metrics';

// Fixed clock so urgency (voting_ends_at − now ≤ window) is deterministic.
const NOW = new Date('2026-06-01T12:00:00Z');
const WITHIN_WINDOW = new Date('2026-06-01T13:00:00Z'); // now + 1h (< 6h default)
const BEYOND_WINDOW = new Date('2026-06-02T12:00:00Z'); // now + 24h

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

function proposal(over: { state?: string; voting_ends_at?: Date | null }): unknown {
  return {
    id: 'prop-1',
    dao_id: 'dao-1',
    description: 'body',
    binding: true,
    state: over.state ?? 'active',
    voting_ends_at: over.voting_ends_at === undefined ? WITHIN_WINDOW : over.voting_ends_at,
  };
}

function completion(): CompletionResult<{ tldr: string }> {
  return {
    output: { tldr: 'ok' },
    cost: { totalUsd: 0.002, inputTokens: 100, outputTokens: 20 },
    provenance: {
      feature: 'proposal_summarizer',
      model: 'claude-haiku-4-5',
      promptVersion: 'v1.0',
      inputHash: 'sha256:x',
      generatedAt: NOW.toISOString(),
    },
  };
}

function violation(): LlmSchemaViolationError {
  return new LlmSchemaViolationError({
    feature: 'proposal_summarizer',
    promptVersion: 'v1.0',
    inputHash: 'sha256:x',
    model: 'claude-haiku-4-5',
    rawOutput: { not_tldr: 1 },
    zodError: SCHEMA.safeParse({}).error!,
    attempts: 2,
  });
}

function deps(over: {
  candidate?: unknown;
  existingOutput?: boolean;
  enabled?: boolean;
  disabled?: boolean;
  complete?: () => Promise<CompletionResult<{ tldr: string }>>;
}) {
  const complete = vi.fn(over.complete ?? (async () => completion()));
  const persist = vi.fn(async () => {});
  const dlqInsert = vi.fn(async () => {});
  const register = vi.fn();
  const handler = new ProposalSummaryHandler(
    { complete } as never,
    { findById: async () => over.candidate } as never,
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
    { register } as never,
  );
  return { handler, complete, persist, dlqInsert, register };
}

const JOB = { feature: 'proposal_summarizer', entityRef: 'proposal:prop-1' } as never;

describe('ProposalSummaryHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('registers itself for the proposal_summarizer feature on module init', () => {
    const { handler, register } = deps({});
    handler.onModuleInit();
    expect(register).toHaveBeenCalledWith('proposal_summarizer', handler);
  });

  it('is inert when the feature is disabled by the trigger flag', async () => {
    const { handler, complete } = deps({ enabled: false, candidate: proposal({}) });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('is inert when the budget cap disabled the feature', async () => {
    const { handler, complete } = deps({ disabled: true, candidate: proposal({}) });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('acks (no completion) when the proposal is missing', async () => {
    const { handler, complete } = deps({ candidate: undefined });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('acks a non-urgent active proposal (deadline beyond the window) for the batch driver', async () => {
    const { handler, complete, persist } = deps({
      candidate: proposal({ state: 'active', voting_ends_at: BEYOND_WINDOW }),
    });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('acks a pending proposal near a deadline (only active proposals are urgent)', async () => {
    const { handler, complete } = deps({
      candidate: proposal({ state: 'pending', voting_ends_at: WITHIN_WINDOW }),
    });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('acks an active proposal with no voting_ends_at', async () => {
    const { handler, complete } = deps({
      candidate: proposal({ state: 'active', voting_ends_at: null }),
    });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('synchronously completes + persists an urgent, uncached active proposal', async () => {
    const tokens = vi.spyOn(aiMetrics.tokensTotal, 'add');
    const { handler, complete, persist } = deps({
      candidate: proposal({ state: 'active', voting_ends_at: WITHIN_WINDOW }),
    });
    await handler.handle(JOB);
    expect(complete).toHaveBeenCalledOnce();
    // sync mode request
    expect(complete.mock.calls[0]![0]).toMatchObject({ mode: 'sync' });
    expect(persist).toHaveBeenCalledOnce();
    expect(tokens).toHaveBeenCalledWith(100, { feature: 'proposal_summarizer', kind: 'input' });
    expect(tokens).toHaveBeenCalledWith(20, { feature: 'proposal_summarizer', kind: 'output' });
  });

  it('skips an urgent proposal already summarized in the cache', async () => {
    const hits = vi.spyOn(aiMetrics.cacheHitsTotal, 'add');
    const { handler, complete } = deps({
      candidate: proposal({ state: 'active', voting_ends_at: WITHIN_WINDOW }),
      existingOutput: true,
    });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
    expect(hits).toHaveBeenCalledWith(1, { feature: 'proposal_summarizer' });
  });

  it('dead-letters a schema violation and acks (no rethrow, no persist)', async () => {
    const { handler, persist, dlqInsert } = deps({
      candidate: proposal({ state: 'active', voting_ends_at: WITHIN_WINDOW }),
      complete: async () => {
        throw violation();
      },
    });
    await expect(handler.handle(JOB)).resolves.toBeUndefined();
    expect(dlqInsert).toHaveBeenCalledOnce();
    expect(dlqInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        feature_name: 'proposal_summarizer',
        prompt_version: 'v1.0',
        input_hash: 'sha256:x',
        attempts: 2,
      }),
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('rethrows a transient (non-schema) error so the job retries', async () => {
    const { handler, dlqInsert } = deps({
      candidate: proposal({ state: 'active', voting_ends_at: WITHIN_WINDOW }),
      complete: async () => {
        throw new Error('rate limited');
      },
    });
    await expect(handler.handle(JOB)).rejects.toThrow('rate limited');
    expect(dlqInsert).not.toHaveBeenCalled();
  });
});
