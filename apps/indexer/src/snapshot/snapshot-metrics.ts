import { defineCounter, defineHistogram } from '@libs/observability';

export const snapshotMetrics = {
  proposalsProcessed: defineCounter({
    name: 'indexer_snapshot_worker_proposals',
    description: 'Voting power snapshot proposal outcomes',
  }),
  sampleMismatch: defineCounter({
    name: 'indexer_snapshot_worker_sample_mismatch',
    description: 'Sample verification mismatches by source type',
  }),
  durationSeconds: defineHistogram({
    name: 'indexer_snapshot_worker_duration_seconds',
    description: 'Wall-clock duration of one snapshot run',
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300],
  }),
  rpcCalls: defineCounter({
    name: 'indexer_snapshot_worker_rpc_calls',
    description: 'Snapshot worker rpc call counts by kind',
  }),
  populationSize: defineHistogram({
    name: 'indexer_snapshot_worker_population_size',
    description: 'Population set size per proposal',
    buckets: [0, 10, 100, 500, 1000, 5000, 10000, 50000],
  }),
} as const;
