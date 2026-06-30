import { defineCounter, defineGauge, defineHistogram } from '@libs/observability';

// `indexer_ingestion_snapshot_*` once the service prefix is applied (ADR-045). The generic
// poll driver already emits pollTick / pollItemsEnqueued; these cover the Snapshot-specific
// client + per-space signal the AG backfill and live operations need.
export const snapshotMetrics = {
  proposalsPolled: defineCounter({
    name: 'ingestion_snapshot_proposals_polled',
    description: 'Snapshot proposals returned by a poll tick, by space_id',
  }),
  votesPolled: defineCounter({
    name: 'ingestion_snapshot_votes_polled',
    description: 'Snapshot votes returned by a poll tick, by space_id',
  }),
  graphqlLatency: defineHistogram({
    name: 'ingestion_snapshot_graphql_latency_ms',
    description: 'Snapshot GraphQL request latency in ms, by entity (proposal|vote)',
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10_000],
  }),
  graphqlErrors: defineCounter({
    name: 'ingestion_snapshot_graphql_errors',
    description: 'Snapshot GraphQL request failures after retries, by entity',
  }),
  rateLimited: defineCounter({
    name: 'ingestion_snapshot_rate_limited',
    description: 'Snapshot GraphQL 429 responses that triggered a backoff',
  }),
  highWaterMarkLag: defineGauge({
    name: 'ingestion_snapshot_high_water_mark_lag_seconds',
    description: 'now - max(created) seen for a space; how far the forward cursor trails the tip',
  }),
  proposalsDerived: defineCounter({
    name: 'ingestion_snapshot_proposals_derived',
    description:
      'Snapshot proposal derivations by outcome (derived|updated|skipped_flagged|deleted|failed)',
  }),
  reconcileRequeried: defineCounter({
    name: 'ingestion_snapshot_reconcile_requeried',
    description: 'Closed Snapshot proposals re-queried by the reconcile pass, by space_id',
  }),
};
