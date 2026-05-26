import { defineCounter, defineGauge, defineHistogram } from '@libs/observability';

export const mirrorEtlMetrics = {
  durationSeconds: defineHistogram({
    name: 'mirror_etl_duration_seconds',
    description: 'Wall-clock duration of one mirror ETL cycle',
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
  }),
  rowsWritten: defineCounter({
    name: 'mirror_etl_rows_written',
    description: 'Mirror ETL rows written to ClickHouse',
  }),
  exactMatch: defineGauge({
    name: 'mirror_etl_exact_match',
    description: 'Mirror ETL exact count match result (1=true, 0=false)',
  }),
  driftRatio: defineGauge({
    name: 'mirror_etl_drift_ratio',
    description: 'Mirror ETL row-count drift ratio |pg-ch|/max(pg,1)',
  }),
  lastSuccessAge: defineGauge({
    name: 'mirror_etl_last_success_age_seconds',
    description: 'Seconds since the last successful mirror ETL cycle per job',
  }),
  attempts: defineCounter({
    name: 'mirror_etl_attempts',
    description: 'Mirror ETL cycle attempts by outcome',
  }),
  skipped: defineCounter({
    name: 'mirror_etl_skipped',
    description: 'Mirror ETL skipped cycles by reason',
  }),
} as const;
