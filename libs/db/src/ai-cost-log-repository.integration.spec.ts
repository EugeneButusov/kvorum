import { afterAll, describe, expect, it } from 'vitest';
import { AiCostLogRepository } from './ai-cost-log-repository';
import { pgDb } from './client';
import type { NewAiCostLog } from './schema/pg';

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
function costRow(overrides: Partial<NewAiCostLog> = {}): NewAiCostLog {
  return {
    timestamp: new Date('2026-07-09T12:00:00Z'),
    feature_name: 'test_mismatch',
    model: 'claude-sonnet-5',
    input_tokens: 1000,
    output_tokens: 200,
    cost_usd: '0.010000',
    dao_id: null,
    entity_reference: null,
    ...overrides,
  };
}

describeWithDb('AiCostLogRepository (integration)', () => {
  it('sumCostForFeatureSince returns 0 when there are no rows', async () => {
    await inRollback(async (trx) => {
      const repo = new AiCostLogRepository(trx);
      expect(await repo.sumCostForFeatureSince('test_mismatch', new Date('2026-01-01'))).toBe(0);
    });
  });

  it('sums only the feature rows since the cutoff, exactly (no float drift)', async () => {
    await inRollback(async (trx) => {
      const repo = new AiCostLogRepository(trx);
      await repo.insert(costRow({ cost_usd: '0.010000' }));
      await repo.insert(costRow({ cost_usd: '0.020000' }));
      await repo.insert(costRow({ feature_name: 'other', cost_usd: '5.000000' })); // different feature
      await repo.insert(costRow({ timestamp: new Date('2020-01-01'), cost_usd: '9.000000' })); // before cutoff
      const total = await repo.sumCostForFeatureSince('test_mismatch', new Date('2026-01-01'));
      expect(total).toBeCloseTo(0.03, 9);
    });
  });
});
