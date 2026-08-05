import { describe, expect, it, vi } from 'vitest';
import { ProposalEmbeddingCache, type EmbeddingWrite } from './proposal-embedding-cache.js';

const WRITE: EmbeddingWrite = {
  proposalId: 'p1',
  embeddingVersion: 'text-embedding-3-small/v1',
  inputHash: 'sha256:abc',
  vector: '[0.1,0.2,0.3]',
  model: 'text-embedding-3-small',
  inputTokens: 4200,
  costUsd: 0.0001,
};

describe('ProposalEmbeddingCache', () => {
  it('writes the cost-log row and the vector upsert in one transaction handle', async () => {
    const costs = { insert: vi.fn(async () => {}) };
    const embeddings = { upsert: vi.fn(async () => {}) };
    const trx = { marker: 'trx' };
    const db = {
      isTransaction: false,
      transaction: () => ({ execute: (fn: (t: unknown) => Promise<void>) => fn(trx) }),
    };
    const cache = new ProposalEmbeddingCache(db as never, embeddings as never, costs as never);

    await cache.persist(WRITE, { daoId: 'dao-1', entityReference: 'proposal:p1' });

    // Both writes ran against the SAME transaction executor.
    expect(costs.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        feature_name: 'embedding',
        model: 'text-embedding-3-small',
        input_tokens: 4200,
        output_tokens: 0,
        cost_usd: '0.0001',
        dao_id: 'dao-1',
        entity_reference: 'proposal:p1',
      }),
      trx,
    );
    expect(embeddings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal_id: 'p1',
        embedding_version: 'text-embedding-3-small/v1',
        input_hash: 'sha256:abc',
        embedding: '[0.1,0.2,0.3]',
        cost_usd: '0.0001',
      }),
      trx,
    );
  });

  it('reuses a handed-in transaction rather than opening a nested one', async () => {
    const costs = { insert: vi.fn(async () => {}) };
    const embeddings = { upsert: vi.fn(async () => {}) };
    const transaction = vi.fn();
    const db = { isTransaction: true, transaction };
    const cache = new ProposalEmbeddingCache(db as never, embeddings as never, costs as never);

    await cache.persist(WRITE, { daoId: null, entityReference: null });

    expect(transaction).not.toHaveBeenCalled();
    expect(costs.insert).toHaveBeenCalledWith(expect.anything(), db);
    expect(embeddings.upsert).toHaveBeenCalledWith(expect.anything(), db);
  });
});
