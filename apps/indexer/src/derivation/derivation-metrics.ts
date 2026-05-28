import { defineCounter, defineGauge, defineHistogram } from '@libs/observability';

// Keep reason labels centralized for projection appliers.
export type DerivationFailureReason =
  | 'unsupported_dispatch'
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error'
  | 'watermark_update_error'
  | 'no_proposal'
  | 'block_timestamp_unavailable'
  | 'unknown_event_type';

export const derivationMetrics = {
  lagSeconds: defineGauge({
    name: 'derivation_lag_seconds',
    description: 'Wall-clock lag behind the oldest confirmed archive row not yet derived',
  }),
  processed: defineCounter({
    name: 'derivation_processed',
    description: 'Derivation row outcomes by source, event type, outcome, and failure reason',
  }),
  tickDurationSeconds: defineHistogram({
    name: 'derivation_tick_duration_seconds',
    description: 'Wall-clock duration of one derivation worker tick',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  }),
  batchLookupSeconds: defineHistogram({
    name: 'derivation_batch_lookup_seconds',
    description: 'Wall-clock duration of one ClickHouse archive payload batch lookup',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  }),
  chWriteSeconds: defineHistogram({
    name: 'derivation_ch_write_seconds',
    description: 'Wall-clock duration of one ClickHouse projection batch write',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  }),
  timestampFill: defineCounter({
    name: 'derivation_timestamp_fill',
    description: 'Lazy voting timestamp fill outcomes',
  }),
  timestampFillBacklog: defineGauge({
    name: 'derivation_timestamp_fill_backlog',
    description: 'Count of proposals pending lazy voting timestamp fill',
  }),
} as const;
