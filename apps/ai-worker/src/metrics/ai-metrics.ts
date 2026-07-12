import { defineCounter, defineGauge, defineHistogram } from '@libs/observability';

// Service prefix (OTEL_SERVICE_NAME='ai-worker' → 'ai_worker_') is prepended by the define* helpers.
export const aiMetrics = {
  // ── queue depth/age (M5-1.4) ──────────────────────────────────────────────
  jobQueueDepth: defineGauge({
    name: 'job_queue_depth',
    description: 'Count of created+retry AI jobs per queue',
  }),
  jobQueueAgeSeconds: defineGauge({
    name: 'job_queue_age_seconds',
    description: 'Age in seconds of the oldest pending AI job per queue (0 if empty)',
  }),

  // ── budget cap (M5-1.5) — recorded by AiBudgetCapService ───────────────────
  costUsd: defineGauge({
    name: 'cost_usd',
    description: 'Month-to-date AI spend (USD) per feature',
  }),
  budgetUtilizationPercent: defineGauge({
    name: 'budget_utilization_percent',
    description: 'Month-to-date spend as a percentage of the feature cap',
  }),
  featureDisabled: defineGauge({
    name: 'feature_disabled',
    description: '1 if the feature is disabled by its budget cap, else 0',
  }),

  // ── job throughput (M5-1.5) — recorded by AiJobConsumer ────────────────────
  jobsTotal: defineCounter({
    name: 'jobs',
    description: 'AI jobs processed by the worker, by feature and outcome',
  }),

  // ── execution instruments — DEFINED here; recorded in M5-2 (feature handlers + cache) ──
  latencySeconds: defineHistogram({
    name: 'latency_seconds',
    description: 'AI job handler duration (seconds) per feature',
    buckets: [0.5, 1, 2, 5, 10, 30, 60],
  }),
  tokensTotal: defineCounter({
    name: 'tokens',
    description: 'LLM tokens consumed per feature and kind (input/output)',
  }),
  cacheHitsTotal: defineCounter({
    name: 'cache_hits',
    description: 'Content-hash cache hits per feature',
  }),
};
