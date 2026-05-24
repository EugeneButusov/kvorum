import { defineCounter, defineHistogram } from '@libs/observability';

export const ensResolverMetrics = {
  resolutions: defineCounter({
    name: 'indexer_ens_resolver_resolutions',
    description: 'ENS reverse resolution outcomes',
  }),
  durationSeconds: defineHistogram({
    name: 'indexer_ens_resolver_duration_seconds',
    description: 'Wall-clock duration of one ENS resolver tick',
    buckets: [0.1, 0.5, 1, 3, 5, 10, 30, 60],
  }),
} as const;
