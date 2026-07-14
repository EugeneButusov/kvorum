process.env['OTEL_SERVICE_NAME'] ??= 'ai-worker';
process.env['OTEL_SERVICE_NAMESPACE'] ??= 'test';
import { describe, expect, it } from 'vitest';
import { aiMetrics } from './ai-metrics';

describe('aiMetrics', () => {
  it('defines the full ai_worker_* instrument set', () => {
    for (const key of [
      'jobQueueDepth',
      'jobQueueAgeSeconds',
      'costUsd',
      'budgetUtilizationPercent',
      'featureDisabled',
      'jobsTotal',
      'latencySeconds',
      'tokensTotal',
      'cacheHitsTotal',
    ] as const) {
      expect(aiMetrics[key]).toBeDefined();
    }
  });

  it('records/adds without throwing (instruments are wired to the meter)', () => {
    expect(() => aiMetrics.costUsd.record(1.5, { feature: 'proposal_summarizer' })).not.toThrow();
    expect(() => aiMetrics.featureDisabled.record(1, { feature: 'embedding' })).not.toThrow();
    expect(() =>
      aiMetrics.jobsTotal.add(1, { feature: 'proposal_summarizer', outcome: 'dispatched' }),
    ).not.toThrow();
    expect(() =>
      aiMetrics.latencySeconds.record(2, { feature: 'mismatch_detector' }),
    ).not.toThrow();
    expect(() =>
      aiMetrics.tokensTotal.add(100, { feature: 'embedding', kind: 'input' }),
    ).not.toThrow();
  });
});
