process.env['OTEL_SERVICE_NAME'] ??= 'ai-worker';
process.env['OTEL_SERVICE_NAMESPACE'] ??= 'test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterAll } from 'vitest';
import { AiCostLogRepository } from '@libs/ai';
import { pgDb } from '@libs/db';
import { AiBudgetCapService } from './ai-budget-cap.service';
import { AiBudgetState } from './ai-budget-state';
import { aiMetrics } from '../metrics/ai-metrics';

type WithTick = { tick(): Promise<void> };

function makeService(spendByFeature: Record<string, number>) {
  const sumCostForFeatureSince = vi.fn(async (feature: string) => spendByFeature[feature] ?? 0);
  const costRepo = { sumCostForFeatureSince } as never;
  const state = new AiBudgetState();
  const svc = new AiBudgetCapService(costRepo, state);
  return { svc: svc as unknown as WithTick, state, sumCostForFeatureSince };
}

describe('AiBudgetCapService.tick', () => {
  afterEach(() => {
    delete process.env['AI_CAP_SUMMARIZE_USD'];
    vi.restoreAllMocks();
  });

  it('disables a feature whose spend reaches its cap and records the gauges', async () => {
    const disabledSpy = vi.spyOn(aiMetrics.featureDisabled, 'record');
    // proposal_summarizer default cap $5; spend $6 → disabled. Others below cap.
    const { svc, state } = makeService({ proposal_summarizer: 6 });
    await svc.tick();

    expect(state.isDisabled('proposal_summarizer')).toBe(true);
    expect(state.get('proposal_summarizer')?.utilizationPct).toBeCloseTo(120);
    expect(state.isDisabled('embedding')).toBe(false);
    expect(disabledSpy).toHaveBeenCalledWith(1, { feature: 'proposal_summarizer' });
  });

  it('treats exactly-at-cap as disabled', async () => {
    const { svc, state } = makeService({ proposal_summarizer: 5 }); // == default cap
    await svc.tick();
    expect(state.isDisabled('proposal_summarizer')).toBe(true);
  });

  it('re-enables when a raised cap env exceeds spend on the next tick', async () => {
    const { svc, state } = makeService({ proposal_summarizer: 6 });
    await svc.tick();
    expect(state.isDisabled('proposal_summarizer')).toBe(true);

    process.env['AI_CAP_SUMMARIZE_USD'] = '10'; // raise above spend
    await svc.tick();
    expect(state.isDisabled('proposal_summarizer')).toBe(false);
  });
});

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

describeWithDb('AiBudgetCapService (integration)', () => {
  afterAll(async () => {
    await pgDb.deleteFrom('ai_cost_log').where('feature_name', '=', 'embedding').execute();
    delete process.env['AI_CAP_EMBED_USD'];
    await pgDb.destroy();
  });

  it('reads real month-to-date spend and disables when it reaches the cap; last-month rows excluded', async () => {
    await pgDb.deleteFrom('ai_cost_log').where('feature_name', '=', 'embedding').execute();
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    // embedding default cap $1. Insert $0.80 this month + $5 last month (excluded).
    await pgDb
      .insertInto('ai_cost_log')
      .values([
        {
          timestamp: thisMonth,
          feature_name: 'embedding',
          model: 'm',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: '0.800000',
          dao_id: null,
          entity_reference: null,
        },
        {
          timestamp: lastMonth,
          feature_name: 'embedding',
          model: 'm',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: '5.000000',
          dao_id: null,
          entity_reference: null,
        },
      ])
      .execute();

    const state = new AiBudgetState();
    const svc = new AiBudgetCapService(new AiCostLogRepository(pgDb), state) as unknown as WithTick;

    // Cap $1 → $0.80 spend → NOT disabled (last month's $5 excluded).
    process.env['AI_CAP_EMBED_USD'] = '1';
    await svc.tick();
    expect(state.isDisabled('embedding')).toBe(false);
    expect(state.get('embedding')?.spendUsd).toBeCloseTo(0.8);

    // Lower cap to $0.50 → $0.80 spend now over cap → disabled.
    process.env['AI_CAP_EMBED_USD'] = '0.5';
    await svc.tick();
    expect(state.isDisabled('embedding')).toBe(true);
  });
});
