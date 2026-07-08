import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CompletionRequest } from './ports.js';
import { buildProvenance, computeInputHash, SystemClock, type Clock } from './provenance.js';

const baseReq: CompletionRequest<unknown> = {
  feature: 'proposal_summarizer',
  promptVersion: 'v1.0',
  model: 'claude-haiku-4-5',
  schema: z.object({}),
  messages: [{ role: 'user', content: 'hi' }],
  mode: 'sync',
  inputContent: 'the proposal body',
};

describe('computeInputHash', () => {
  it('is deterministic and sha256-prefixed', () => {
    const a = computeInputHash('the proposal body');
    const b = computeInputHash('the proposal body');
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('differs for different content', () => {
    expect(computeInputHash('a')).not.toBe(computeInputHash('b'));
  });
});

describe('buildProvenance', () => {
  it('assembles provenance with an injected clock', () => {
    const fixed: Clock = { now: () => '2026-07-08T00:00:00.000Z' };
    const hash = computeInputHash(baseReq.inputContent);
    const prov = buildProvenance(baseReq, hash, fixed);
    expect(prov).toEqual({
      feature: 'proposal_summarizer',
      model: 'claude-haiku-4-5',
      promptVersion: 'v1.0',
      inputHash: hash,
      generatedAt: '2026-07-08T00:00:00.000Z',
    });
  });

  it('SystemClock returns a valid ISO-8601 string', () => {
    expect(() => new Date(new SystemClock().now()).toISOString()).not.toThrow();
  });
});
