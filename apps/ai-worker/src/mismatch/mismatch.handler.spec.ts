import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmSchemaViolationError, type CompletionResult, type RenderedPrompt } from '@libs/ai';
import { MismatchHandler } from './mismatch.handler';
import { aiMetrics } from '../metrics/ai-metrics';

const SCHEMA = z.object({ overall_assessment: z.string() });

function rendered(): RenderedPrompt<{ overall_assessment: string }> {
  return {
    feature: 'mismatch_detector',
    promptVersion: 'v1.0',
    model: 'claude-sonnet-5',
    schema: SCHEMA,
    messages: [{ role: 'user', content: 'analyze' }],
    inputContent: JSON.stringify({ decoded_actions: '[]', description: 'body' }),
  };
}

function completion(): CompletionResult<{ overall_assessment: string }> {
  return {
    output: { overall_assessment: 'consistent' },
    cost: { totalUsd: 0.05, inputTokens: 12000, outputTokens: 1500 },
    provenance: {
      feature: 'mismatch_detector',
      model: 'claude-sonnet-5',
      promptVersion: 'v1.0',
      inputHash: 'sha256:x',
      generatedAt: '2026-06-01T12:00:00Z',
    },
  };
}

function violation(): LlmSchemaViolationError {
  return new LlmSchemaViolationError({
    feature: 'mismatch_detector',
    promptVersion: 'v1.0',
    inputHash: 'sha256:x',
    model: 'claude-sonnet-5',
    rawOutput: { bad: 1 },
    zodError: SCHEMA.safeParse({}).error!,
    attempts: 2,
  });
}

function deps(over: {
  proposal?: unknown;
  existingOutput?: boolean;
  enabled?: boolean;
  disabled?: boolean;
  complete?: () => Promise<CompletionResult<{ overall_assessment: string }>>;
}) {
  const complete = vi.fn(over.complete ?? (async () => completion()));
  const persist = vi.fn(async () => {});
  const dlqInsert = vi.fn(async () => {});
  const register = vi.fn();
  const proposal =
    'proposal' in over ? over.proposal : { id: 'prop-1', dao_id: 'dao-1', binding: true };
  const handler = new MismatchHandler(
    { complete } as never,
    { findById: async () => proposal } as never,
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

const JOB = { feature: 'mismatch_detector', entityRef: 'proposal:prop-1' } as never;

describe('MismatchHandler', () => {
  it('registers itself for the mismatch_detector feature on module init', () => {
    const { handler, register } = deps({});
    handler.onModuleInit();
    expect(register).toHaveBeenCalledWith('mismatch_detector', handler);
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

  it('skips when the proposal is missing', async () => {
    const { handler, complete } = deps({ proposal: undefined });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('skips a non-binding proposal (Snapshot excluded)', async () => {
    const { handler, complete } = deps({
      proposal: { id: 'prop-1', dao_id: 'dao-1', binding: false },
    });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
  });

  it('synchronously analyzes + persists a binding, uncached proposal', async () => {
    const tokens = vi.spyOn(aiMetrics.tokensTotal, 'add');
    const { handler, complete, persist } = deps({});
    await handler.handle(JOB);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]![0]).toMatchObject({ mode: 'sync' });
    expect(persist).toHaveBeenCalledOnce();
    expect(tokens).toHaveBeenCalledWith(12000, { feature: 'mismatch_detector', kind: 'input' });
    expect(tokens).toHaveBeenCalledWith(1500, { feature: 'mismatch_detector', kind: 'output' });
  });

  it('skips an already-analyzed proposal (cache hit)', async () => {
    const hits = vi.spyOn(aiMetrics.cacheHitsTotal, 'add');
    const { handler, complete } = deps({ existingOutput: true });
    await handler.handle(JOB);
    expect(complete).not.toHaveBeenCalled();
    expect(hits).toHaveBeenCalledWith(1, { feature: 'mismatch_detector' });
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
      expect.objectContaining({ feature_name: 'mismatch_detector', attempts: 2 }),
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
