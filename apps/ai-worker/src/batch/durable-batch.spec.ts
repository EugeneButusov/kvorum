import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchHandle, BatchItemDescriptor, LLMClient, OpenBatch } from '@libs/ai';
import type { PgDatabase } from '@libs/db';
import { DurableBatch, toDescriptor } from './durable-batch';
import type { PersistBatchDeps } from './persist-batch-item';

// A valid ProposalSummary (the schema resolved by feature during a drain).
const VALID_SUMMARY = {
  tldr: 'ok',
  proposal_type: 'parameter_change',
  proposal_type_confidence: 'high',
  affected_contracts: [],
  key_changes: [],
  funding_amount_usd: null,
};

const DESC: BatchItemDescriptor = {
  customId: 'c1',
  feature: 'proposal_summarizer',
  promptVersion: 'v1.0',
  model: 'claude-haiku-4-5',
  inputHash: 'sha256:abc',
  daoId: 'dao-1',
  entityReference: 'proposal:p1',
};

function openBatch(over: Partial<OpenBatch> = {}): OpenBatch {
  return {
    id: 'b1',
    provider: 'anthropic',
    providerBatchId: 'msgbatch_1',
    feature: 'proposal_summarizer',
    pendingCursor: 'p1',
    items: [DESC],
    ...over,
  };
}

// The whole drain runs inside one transaction; the fake just invokes the callback with a stub trx.
const fakeDb = {
  transaction: () => ({ execute: async (cb: (trx: unknown) => Promise<void>) => cb({}) }),
} as unknown as Kysely<PgDatabase>;

function makeHarness(over: { open?: OpenBatch | null; fetch?: unknown } = {}) {
  // Stateful open row: findOpenByFeature returns it until deleteById clears it (models a restart —
  // a fresh DurableBatch reads the same durable row).
  let open = over.open === undefined ? openBatch() : over.open;
  const batches = {
    findOpenByFeature: vi.fn(async () => open ?? undefined),
    deleteById: vi.fn(async () => {
      open = null;
    }),
    insert: vi.fn(async () => {}),
  };
  const cursors = { get: vi.fn(async () => null), upsert: vi.fn(async () => {}) };
  const llm = {
    fetchBatch: vi.fn(
      async () =>
        (over.fetch as { status: string; results: unknown[] }) ?? { status: 'ended', results: [] },
    ),
  } as unknown as LLMClient;
  const persistDeps: PersistBatchDeps = {
    outputs: { insert: vi.fn(async () => ({})), find: vi.fn() } as never,
    costs: { insert: vi.fn(async () => {}) } as never,
    dlq: { insert: vi.fn(async () => {}) } as never,
    clock: { now: () => '2026-08-24T00:00:00.000Z' },
  };
  const durable = new DurableBatch(fakeDb, llm, batches as never, cursors as never, persistDeps);
  return { durable, batches, cursors, llm, persistDeps };
}

describe('DurableBatch', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('is idle when no open batch exists', async () => {
    const { durable, llm } = makeHarness({ open: null });
    expect(await durable.pollOpen('proposal_summarizer')).toEqual({ state: 'idle' });
    expect(llm.fetchBatch).not.toHaveBeenCalled();
  });

  it('is waiting while the provider batch is still processing', async () => {
    const { durable, batches, persistDeps } = makeHarness({
      fetch: { status: 'in_progress', results: [] },
    });
    expect(await durable.pollOpen('proposal_summarizer')).toEqual({ state: 'waiting' });
    expect(batches.deleteById).not.toHaveBeenCalled();
    expect(persistDeps.outputs.insert).not.toHaveBeenCalled();
  });

  it('prices from the durable per-item model map', async () => {
    const { durable, llm } = makeHarness({
      fetch: {
        status: 'ended',
        results: [{ customId: 'c1', parsed: VALID_SUMMARY, cost: zeroCost() }],
      },
    });
    await durable.pollOpen('proposal_summarizer');
    expect(llm.fetchBatch).toHaveBeenCalledWith(
      { id: 'msgbatch_1', provider: 'anthropic' },
      { c1: 'claude-haiku-4-5' },
    );
  });

  it('drains a finished batch: persists output + cost, commits the cursor, deletes the row', async () => {
    const { durable, batches, cursors, persistDeps } = makeHarness({
      fetch: {
        status: 'ended',
        results: [{ customId: 'c1', parsed: VALID_SUMMARY, cost: zeroCost() }],
      },
    });
    const out = await durable.pollOpen('proposal_summarizer');
    expect(out).toEqual({ state: 'drained', pendingCursor: 'p1' });
    expect(persistDeps.outputs.insert).toHaveBeenCalledOnce();
    expect(persistDeps.costs.insert).toHaveBeenCalledOnce();
    expect(cursors.upsert).toHaveBeenCalledWith('proposal_summarizer', 'p1', expect.anything());
    expect(batches.deleteById).toHaveBeenCalledOnce();
  });

  it('dead-letters a schema-violating result and still books its cost', async () => {
    const { durable, batches, persistDeps } = makeHarness({
      fetch: {
        status: 'ended',
        results: [{ customId: 'c1', parsed: { bad: 1 }, cost: zeroCost() }],
      },
    });
    await durable.pollOpen('proposal_summarizer');
    expect(persistDeps.dlq.insert).toHaveBeenCalledOnce();
    expect(persistDeps.costs.insert).toHaveBeenCalledOnce();
    expect(persistDeps.outputs.insert).not.toHaveBeenCalled();
    expect(batches.deleteById).toHaveBeenCalledOnce();
  });

  it('does not commit a cursor for a live (null pending_cursor) batch', async () => {
    const { durable, cursors } = makeHarness({
      open: openBatch({ pendingCursor: null }),
      fetch: {
        status: 'ended',
        results: [{ customId: 'c1', parsed: VALID_SUMMARY, cost: zeroCost() }],
      },
    });
    await durable.pollOpen('proposal_summarizer');
    expect(cursors.upsert).not.toHaveBeenCalled();
  });

  it('no double-charge on re-poll: once drained, the row is gone and a second poll is idle', async () => {
    const { durable, persistDeps } = makeHarness({
      fetch: {
        status: 'ended',
        results: [{ customId: 'c1', parsed: VALID_SUMMARY, cost: zeroCost() }],
      },
    });
    expect((await durable.pollOpen('proposal_summarizer')).state).toBe('drained');
    expect((await durable.pollOpen('proposal_summarizer')).state).toBe('idle');
    expect(persistDeps.costs.insert).toHaveBeenCalledOnce(); // charged exactly once
  });

  it('record() inserts the durable in-flight row', async () => {
    const { durable, batches } = makeHarness({ open: null });
    const handle: BatchHandle = { id: 'msgbatch_9', provider: 'anthropic' };
    await durable.record('forum_synthesizer', handle, [DESC], 'cursor-9');
    expect(batches.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        providerBatchId: 'msgbatch_9',
        feature: 'forum_synthesizer',
        pendingCursor: 'cursor-9',
        items: [DESC],
      }),
    );
  });
});

describe('toDescriptor', () => {
  it('captures pricing + persistence fields (and hashes inputContent)', () => {
    const desc = toDescriptor(
      {
        customId: 'forum_thread_t1',
        request: {
          feature: 'forum_synthesizer',
          promptVersion: 'v1.0',
          model: 'claude-sonnet-5',
          schema: undefined as never,
          messages: [],
          mode: 'batch',
          inputContent: 'thread body',
          routingReason: 'long',
        },
      },
      { daoId: 'dao-2', entityReference: 'forum_thread:t1' },
    );
    expect(desc).toMatchObject({
      customId: 'forum_thread_t1',
      feature: 'forum_synthesizer',
      model: 'claude-sonnet-5',
      routingReason: 'long',
      daoId: 'dao-2',
      entityReference: 'forum_thread:t1',
    });
    expect(desc.inputHash).toMatch(/^sha256:/);
  });
});

function zeroCost() {
  return { totalUsd: 0.002, inputTokens: 100, outputTokens: 20 };
}
