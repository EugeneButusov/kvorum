import { defineCounter, defineGauge, defineHistogram } from '@libs/observability';

export const reconciliationMetrics = {
  chOrphanTotal: defineCounter({
    name: 'indexer_reconciliation_ch_orphan',
    description: 'CH-orphan sweep outcomes by dao_source_id',
  }),
  pgOrphanTotal: defineCounter({
    name: 'indexer_reconciliation_pg_orphan',
    description: 'PG-orphan sweep outcomes by dao_source_id',
  }),
  sweepDurationSeconds: defineHistogram({
    name: 'indexer_reconciliation_sweep_duration_seconds',
    description: 'Wall-clock duration of reconciliation sweep ticks',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30],
  }),
  watermarkLagBlocks: defineGauge({
    name: 'indexer_reconciliation_watermark_lag_blocks',
    description: 'Lag between confirmed head and sweep watermark by dao_source_id',
  }),
} as const;
