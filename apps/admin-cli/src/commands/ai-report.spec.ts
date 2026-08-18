import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import {
  buildMonthlyReport,
  type CategorySpend,
  queryMonthlyCostReport,
  resolveMonthWindow,
  resolvePreviousMonthWindow,
  TYPICAL_MONTHLY_USD,
} from './ai-report.js';

describe('resolvePreviousMonthWindow', () => {
  it('resolves the full previous calendar month in UTC', () => {
    const w = resolvePreviousMonthWindow(new Date('2026-08-18T09:00:00Z'));
    expect(w.since.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(w.until.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(w.label).toBe('2026-07');
  });

  it('rolls back across the year boundary (January → previous December)', () => {
    const w = resolvePreviousMonthWindow(new Date('2026-01-15T00:00:00Z'));
    expect(w.since.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(w.until.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(w.label).toBe('2025-12');
  });
});

describe('resolveMonthWindow', () => {
  it('resolves an explicit YYYY-MM to its [first, next-first) window', () => {
    const w = resolveMonthWindow('2026-03');
    expect('error' in w).toBe(false);
    if ('error' in w) return;
    expect(w.since.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(w.until.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(w.label).toBe('2026-03');
  });

  it('crosses the year boundary for December', () => {
    const w = resolveMonthWindow('2026-12');
    if ('error' in w) throw new Error('unexpected error');
    expect(w.until.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects a malformed month and an out-of-range month', () => {
    expect(resolveMonthWindow('nope')).toEqual({
      error: expect.stringMatching(/expected YYYY-MM/),
    });
    expect(resolveMonthWindow('2026-13')).toEqual({
      error: expect.stringMatching(/month must be 01-12/),
    });
  });
});

describe('buildMonthlyReport', () => {
  const window = {
    since: new Date('2026-05-01T00:00:00Z'),
    until: new Date('2026-06-01T00:00:00Z'),
    label: '2026-05',
  };

  it('folds per-feature/model/DAO rows, sorts breakdowns by spend, and computes deviation vs typical', () => {
    const report = buildMonthlyReport(
      [
        { feature: 'proposal_summarizer', spendUsd: 2, capUsd: 5 },
        { feature: 'mismatch_detector', spendUsd: 4, capUsd: 20 },
        { feature: 'forum_synthesizer', spendUsd: 0, capUsd: 15 },
        { feature: 'embedding', spendUsd: 0, capUsd: 1 },
      ],
      [
        { key: 'claude-haiku-4-5', spendUsd: 2 },
        { key: 'claude-sonnet-5', spendUsd: 4 },
      ] as CategorySpend[],
      [{ key: 'compound', spendUsd: 6 }] as CategorySpend[],
      window,
    );
    expect(report.window.label).toBe('2026-05');
    expect(report.totalSpendUsd).toBeCloseTo(6);
    expect(report.ceilingUsd).toBe(41);
    // by-model sorted spend-descending (sonnet before haiku)
    expect(report.byModel.map((r) => r.key)).toEqual(['claude-sonnet-5', 'claude-haiku-4-5']);
    // deviation: (6 − 12) / 12 × 100 = −50%
    expect(report.typicalUsd).toBe(TYPICAL_MONTHLY_USD);
    expect(report.deviationPct).toBeCloseTo(-50);
  });
});

// ── DB-gated integration: the windowed GROUP BY queries against ai_cost_log ────────────────────────
const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;
class RollbackSignal extends Error {}

afterAll(async () => {
  await pgDb.destroy().catch(() => {});
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

describeWithDb('queryMonthlyCostReport (integration)', () => {
  it('sums by feature/model/DAO within [since, until), excluding out-of-window rows', async () => {
    await inRollback(async (trx) => {
      const [dao] = await trx
        .insertInto('dao')
        .values({
          slug: 'report-dao',
          name: 'Report DAO',
          primary_token_address: '0x' + 'c'.repeat(40),
          primary_chain_id: 1,
          description: 'r',
          website_url: 'https://r.example.com',
          forum_url: 'https://f.r.example.com',
          updated_at: new Date(),
        })
        .returning(['id'])
        .execute();
      const inWindow = new Date('2099-01-15T00:00:00Z');
      const outOfWindow = new Date('2098-12-15T00:00:00Z');
      const row = (over: Partial<Record<string, unknown>>) => ({
        timestamp: inWindow,
        feature_name: 'proposal_summarizer',
        model: 'claude-haiku-4-5',
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: '0.000000',
        dao_id: dao!.id,
        entity_reference: null,
        ...over,
      });
      await trx
        .insertInto('ai_cost_log')
        .values([
          row({
            feature_name: 'proposal_summarizer',
            model: 'claude-haiku-4-5',
            cost_usd: '1.500000',
          }),
          row({
            feature_name: 'mismatch_detector',
            model: 'claude-sonnet-5',
            cost_usd: '2.000000',
          }),
          // system row: NULL dao_id → the (system/no-dao) bucket
          row({
            feature_name: 'embedding',
            model: 'text-embedding-3-small',
            cost_usd: '0.100000',
            dao_id: null,
          }),
          // out-of-window: must be excluded from every rollup
          row({
            feature_name: 'mismatch_detector',
            model: 'claude-sonnet-5',
            cost_usd: '99.000000',
            timestamp: outOfWindow,
          }),
        ])
        .execute();

      const window = resolveMonthWindow('2099-01');
      if ('error' in window) throw new Error(window.error);
      const report = await queryMonthlyCostReport(trx, window);

      const feat = Object.fromEntries(report.perFeature.map((r) => [r.feature, r.spendUsd]));
      expect(feat['proposal_summarizer']).toBeCloseTo(1.5);
      expect(feat['mismatch_detector']).toBeCloseTo(2.0); // the $99 out-of-window row excluded
      expect(feat['embedding']).toBeCloseTo(0.1);
      expect(feat['forum_synthesizer']).toBeCloseTo(0);
      expect(report.totalSpendUsd).toBeCloseTo(3.6);

      const model = Object.fromEntries(report.byModel.map((r) => [r.key, r.spendUsd]));
      expect(model['claude-haiku-4-5']).toBeCloseTo(1.5);
      expect(model['claude-sonnet-5']).toBeCloseTo(2.0);
      expect(model['text-embedding-3-small']).toBeCloseTo(0.1);

      const daoSpend = Object.fromEntries(report.byDao.map((r) => [r.key, r.spendUsd]));
      expect(daoSpend['report-dao']).toBeCloseTo(3.5); // 1.5 + 2.0
      expect(daoSpend['(system/no-dao)']).toBeCloseTo(0.1);
    });
  });
});
