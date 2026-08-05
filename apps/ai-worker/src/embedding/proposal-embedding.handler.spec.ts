import { describe, expect, it, vi } from 'vitest';
import { proposalEmbeddingInputContent, proposalEmbeddingInputHash } from '@libs/ai';
import type { Proposal } from '@libs/db';
import { ProposalEmbeddingHandler } from './proposal-embedding.handler';
import { aiMetrics } from '../metrics/ai-metrics';

const TITLE = 'Raise reserve factor';
const DESC = 'Body.';

function embedding() {
  return {
    vector: [0.1, 0.2, 0.3],
    cost: { totalUsd: 0.0001, inputTokens: 4200, outputTokens: 0 },
    model: 'text-embedding-3-small',
  };
}

function proposal(over: Partial<Proposal> = {}): Proposal {
  return { id: 'p1', dao_id: 'dao-1', title: TITLE, description: DESC, ...over } as Proposal;
}

function deps(over: {
  proposal?: Proposal | undefined;
  existingHash?: string;
  enabled?: boolean;
  disabled?: boolean;
  embed?: () => Promise<ReturnType<typeof embedding>>;
}) {
  const embed = vi.fn(over.embed ?? (async () => embedding()));
  const persist = vi.fn(async () => {});
  const register = vi.fn();
  const proposalResult = 'proposal' in over ? over.proposal : proposal();
  const existing = over.existingHash !== undefined ? { input_hash: over.existingHash } : undefined;
  const handler = new ProposalEmbeddingHandler(
    { embed } as never,
    { findById: async () => proposalResult } as never,
    { findActions: async () => [] } as never,
    { findByProposalVersion: async () => existing } as never,
    { persist } as never,
    { isEnabled: () => over.enabled ?? true } as never,
    { isDisabled: () => over.disabled ?? false } as never,
    { register } as never,
  );
  return { handler, embed, persist, register };
}

const JOB = { feature: 'embedding', entityRef: 'proposal:p1' } as never;

describe('ProposalEmbeddingHandler', () => {
  it('registers itself for the embedding feature on module init', () => {
    const { handler, register } = deps({});
    handler.onModuleInit();
    expect(register).toHaveBeenCalledWith('embedding', handler);
  });

  it('is inert when the feature flag is off', async () => {
    const { handler, embed } = deps({ enabled: false });
    await handler.handle(JOB);
    expect(embed).not.toHaveBeenCalled();
  });

  it('is inert when the budget cap disabled the feature', async () => {
    const { handler, embed } = deps({ disabled: true });
    await handler.handle(JOB);
    expect(embed).not.toHaveBeenCalled();
  });

  it('skips when the proposal is missing', async () => {
    const { handler, embed } = deps({ proposal: undefined });
    await handler.handle(JOB);
    expect(embed).not.toHaveBeenCalled();
  });

  it('embeds the composed input and persists the vector on a cache miss', async () => {
    const tokens = vi.spyOn(aiMetrics.tokensTotal, 'add');
    const { handler, embed, persist } = deps({});
    await handler.handle(JOB);
    expect(embed).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: proposalEmbeddingInputContent(TITLE, DESC, []),
    });
    expect(persist.mock.calls[0]![0]).toMatchObject({
      proposalId: 'p1',
      embeddingVersion: 'text-embedding-3-small/v1',
      vector: '[0.1,0.2,0.3]',
      model: 'text-embedding-3-small',
      inputTokens: 4200,
      costUsd: 0.0001,
    });
    expect(persist.mock.calls[0]![1]).toEqual({ daoId: 'dao-1', entityReference: 'proposal:p1' });
    expect(tokens).toHaveBeenCalledWith(4200, { feature: 'embedding', kind: 'input' });
  });

  it('cache-hits (no API call) when the stored input_hash matches', async () => {
    const hits = vi.spyOn(aiMetrics.cacheHitsTotal, 'add');
    const { handler, embed, persist } = deps({
      existingHash: proposalEmbeddingInputHash(TITLE, DESC, []),
    });
    await handler.handle(JOB);
    expect(embed).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(hits).toHaveBeenCalledWith(1, { feature: 'embedding' });
  });

  it('re-embeds when the stored input_hash is stale (content changed)', async () => {
    const { handler, embed } = deps({ existingHash: 'sha256:stale' });
    await handler.handle(JOB);
    expect(embed).toHaveBeenCalledOnce();
  });

  it('embeds a title-less proposal without a title line', async () => {
    const { handler, embed } = deps({ proposal: proposal({ title: null }) });
    await handler.handle(JOB);
    expect(embed.mock.calls[0]![0]).toEqual({
      model: 'text-embedding-3-small',
      input: proposalEmbeddingInputContent(null, DESC, []),
    });
  });

  it('rethrows an embed error (job retries) and persists nothing', async () => {
    const { handler, persist } = deps({
      embed: async () => {
        throw new Error('rate limited');
      },
    });
    await expect(handler.handle(JOB)).rejects.toThrow('rate limited');
    expect(persist).not.toHaveBeenCalled();
  });
});
