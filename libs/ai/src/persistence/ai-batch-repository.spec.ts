import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { AiBatchRepository } from './ai-batch-repository.js';
import type { BatchHandle, BatchItemDescriptor } from '../llm/ports.js';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;
class RollbackSignal extends Error {}
afterAll(async () => {
  await pgDb.destroy();
});
async function inRollback(fn: (trx: typeof pgDb) => Promise<void>): Promise<void> {
  await pgDb
    .transaction()
    .execute(async (trx) => {
      await fn(trx);
      throw new RollbackSignal();
    })
    .catch((err) => {
      if (!(err instanceof RollbackSignal)) throw err;
    });
}

function descriptor(overrides: Partial<BatchItemDescriptor> = {}): BatchItemDescriptor {
  return {
    customId: 'proposal-1',
    feature: 'proposal_summarizer',
    provider: 'anthropic',
    promptVersion: 'v1.0',
    model: 'claude-haiku-4-5',
    generationProfileId: 'anthropic-fast-v1',
    inputHash: 'sha256:input-1',
    daoId: 'dao-1',
    entityReference: 'proposal:1',
    ...overrides,
  };
}

function batch(
  feature: string,
  overrides: Partial<Parameters<AiBatchRepository['insert']>[0]> = {},
): Parameters<AiBatchRepository['insert']>[0] {
  const providerBatchId = `batch-${randomUUID()}`;
  const handle: BatchHandle = { id: providerBatchId, provider: 'anthropic' };
  return {
    provider: 'anthropic',
    providerBatchId,
    handle,
    feature,
    pendingCursor: null,
    items: [descriptor({ feature })],
    submittedAt: new Date('2026-10-01T12:00:00Z'),
    ...overrides,
  };
}

describeWithDb('AiBatchRepository (integration)', () => {
  it('returns undefined when the feature has no open batch', async () => {
    await inRollback(async (trx) => {
      const repo = new AiBatchRepository(trx);
      await expect(repo.findOpenByFeature(`missing-${randomUUID()}`)).resolves.toBeUndefined();
    });
  });

  it('round-trips a composite provider handle and restart-safe item descriptors', async () => {
    await inRollback(async (trx) => {
      const feature = `forum-${randomUUID()}`;
      const handle: BatchHandle = {
        id: `logical-${randomUUID()}`,
        provider: 'openai',
        children: [
          { id: `fast-${randomUUID()}`, provider: 'openai' },
          { id: `strong-${randomUUID()}`, provider: 'openai' },
        ],
        itemModels: {
          short: 'gpt-6-luna',
          contentious: 'gpt-6.1-sol',
        },
      };
      const items = [
        descriptor({
          customId: 'short',
          feature,
          provider: 'openai',
          model: 'gpt-6-luna',
          generationProfileId: 'openai-fast-v1',
          routingReason: 'short',
        }),
        descriptor({
          customId: 'contentious',
          feature,
          provider: 'openai',
          model: 'gpt-6.1-sol',
          generationProfileId: 'openai-strong-v1',
          routingReason: 'contentious',
          daoId: null,
          entityReference: null,
        }),
      ];
      const repo = new AiBatchRepository(trx);

      await repo.insert(
        batch(feature, {
          provider: 'openai',
          providerBatchId: handle.id,
          handle,
          pendingCursor: 'cursor-42',
          items,
        }),
      );

      await expect(repo.findOpenByFeature(feature)).resolves.toEqual({
        id: expect.any(String),
        provider: 'openai',
        providerBatchId: handle.id,
        handle,
        feature,
        pendingCursor: 'cursor-42',
        items,
      });
    });
  });

  it('selects the oldest submitted batch when defensive duplicate feature rows exist', async () => {
    await inRollback(async (trx) => {
      const feature = `duplicate-${randomUUID()}`;
      const repo = new AiBatchRepository(trx);
      const newer = batch(feature, { submittedAt: new Date('2026-10-01T12:01:00Z') });
      const older = batch(feature, { submittedAt: new Date('2026-10-01T12:00:00Z') });
      await repo.insert(newer);
      await repo.insert(older);

      const open = await repo.findOpenByFeature(feature);

      expect(open?.providerBatchId).toBe(older.providerBatchId);
    });
  });

  it('deletes an open batch by id', async () => {
    await inRollback(async (trx) => {
      const feature = `delete-${randomUUID()}`;
      const repo = new AiBatchRepository(trx);
      await repo.insert(batch(feature));
      const open = await repo.findOpenByFeature(feature);
      expect(open).toBeDefined();

      await repo.deleteById(open?.id as string);

      await expect(repo.findOpenByFeature(feature)).resolves.toBeUndefined();
    });
  });

  it('uses the supplied executor so insert, read, and delete join the caller transaction', async () => {
    const feature = `executor-${randomUUID()}`;
    const repo = new AiBatchRepository(pgDb);

    await inRollback(async (trx) => {
      await repo.insert(batch(feature), trx);
      const open = await repo.findOpenByFeature(feature, trx);
      expect(open).toBeDefined();
      await repo.deleteById(open?.id as string, trx);
      await expect(repo.findOpenByFeature(feature, trx)).resolves.toBeUndefined();
    });

    await expect(repo.findOpenByFeature(feature)).resolves.toBeUndefined();
  });
});
