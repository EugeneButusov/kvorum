import { defineCounter, defineGauge, defineHistogram } from '@libs/observability';

/** Methods allowed as the `method` attribute. Anything else is recorded as "other". */
const ALLOWED_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getLogs',
  'eth_getStorageAt',
]);

export function sanitizeMethod(method: string): string {
  return ALLOWED_METHODS.has(method) ? method : 'other';
}

export const chainMetrics = {
  // ---- counters ----
  rpcRequests: defineCounter({
    name: 'ingestion_rpc_requests',
    description: 'Total JSON-RPC requests dispatched by the failover client',
  }),
  rpcFailures: defineCounter({
    name: 'ingestion_rpc_failures',
    description: 'Total failed JSON-RPC requests by error reason',
  }),
  healthCheckFailures: defineCounter({
    name: 'ingestion_health_check_failures',
    description: 'Total health check failures per provider',
  }),
  logsFetched: defineCounter({
    name: 'ingestion_logs_fetched',
    description: 'Total logs returned by eth_getLogs (re-fetches counted; not de-duped events)',
  }),
  logsWithRemovedFlag: defineCounter({
    name: 'ingestion_logs_with_removed_flag',
    description: 'Count of logs ethers v6 marks removed:true',
  }),
  reorgSignals: defineCounter({
    name: 'ingestion_reorg_signals',
    description:
      'Reorg signals emitted by the in-process detector. Each signal corresponds to one parent-hash mismatch, head drop, or chain-shrink event.',
  }),
  proxyResolutions: defineCounter({
    name: 'ingestion_proxy_resolutions',
    description:
      'Proxy resolution outcomes. result=resolved|not_a_proxy|capped|cycle|all_slots_failed',
  }),
  archiveWrites: defineCounter({
    name: 'ingestion_archive_writes',
    description:
      'Archive write outcomes by source. result=inserted|skipped_existing|skipped_conflict|dlq_routed',
  }),
  archiveSkippedExistence: defineCounter({
    name: 'archive_skipped_existence',
    description: 'PG-first existence check hits (ADR-041 step 1)',
  }),
  archiveChWriteErrors: defineCounter({
    name: 'archive_ch_write_errors',
    description: 'CH-insert failures per source',
  }),
  archiveDecodeErrors: defineCounter({
    name: 'archive_decode_errors',
    description:
      'DecodeError occurrences per source. reason=unknown_topic|parse_failed|wrong_address',
  }),
  dualWritePgUnreachable: defineCounter({
    name: 'dual_write_pg_unreachable',
    description: 'PG unreachable for the DLQ insert itself (ADR-041 step 5)',
  }),

  // ---- gauges ----
  circuitState: defineGauge({
    name: 'ingestion_circuit_state',
    description: 'Circuit breaker state per provider: 0=closed, 1=half-open, 2=open',
  }),
  providerLagBlocks: defineGauge({
    name: 'ingestion_provider_lag_blocks',
    description: 'How many blocks behind the chain leader this provider is',
  }),
  providerUnusable: defineGauge({
    name: 'ingestion_provider_unusable',
    description:
      '1 if the provider is unusable (chainId mismatch or probe-retry exhausted), 0 otherwise',
  }),
  providerVerified: defineGauge({
    name: 'ingestion_provider_verified',
    description: '1 if the provider has passed chainId verification, 0 otherwise',
  }),
  headBlockAge: defineGauge({
    name: 'ingestion_head_block_age_seconds',
    description:
      'Wall-clock minus chain-reported timestamp of last observed head. NTP skew can produce false-positive stale-source alarms; alert threshold should be generous (>60s).',
  }),
  headPollLag: defineGauge({
    name: 'ingestion_head_poll_lag_seconds',
    description: 'Wall-clock minus last successful head-poll completion. Stalled-poller alarm.',
  }),
  logPollLag: defineGauge({
    name: 'ingestion_log_poll_lag_seconds',
    description:
      'Wall-clock minus last successful log-poll completion per dao_source. Backs SPEC §6.20.2 ingestion-lag alert.',
  }),
  logPollWindowBlocks: defineGauge({
    name: 'ingestion_log_poll_window_blocks',
    description: 'Current window size in blocks. Diagnostic; constant in v1 (2 × reorgHorizon).',
  }),
  pendingEventCount: defineGauge({
    name: 'ingestion_pending_event_count',
    description:
      'Count of archive_confirmation rows in pending state per chain × source_type. Updated by periodic recalculation, not per-write.',
  }),
  indexerActiveSources: defineGauge({
    name: 'indexer_active_sources',
    description:
      'Count of dao_source rows the indexer booted with per source_type. Zero is a deployable-but-actionable signal (misconfigured table).',
  }),

  reorgEvent: defineCounter({
    name: 'ingestion_reorg_event',
    description:
      'Reorg events persisted to PG (one per ReorgDetector signal that successfully wrote a reorg_event row). chain label.',
  }),
  orphanedEvents: defineCounter({
    name: 'ingestion_orphaned_events',
    description:
      'Count of archive_confirmation rows transitioned to orphaned by a reorg handler. Summed across all reorgs per chain.',
  }),
  reorgTruncated: defineCounter({
    name: 'ingestion_reorg_truncated',
    description:
      'Reorg signals flagged as truncated (divergence extends past oldest buffered block). Operator alert — divergence root is approximate.',
  }),

  dlqDepth: defineGauge({
    name: 'ingestion_dlq_size',
    description:
      'Count of unresolved rows in ingestion_dlq per (stage, source). Updated by periodic recalculation (~10s), not per-write. Drains on dlq retry/accept (ADR-032).',
  }),
  backfillProgressBlock: defineGauge({
    name: 'ingestion_backfill_progress_block',
    description:
      'Last block committed by the backfill driver per source. Advances once per chunk; resets to 0 on fresh start.',
  }),

  // ---- histograms ----
  promotionSweepDuration: defineHistogram({
    name: 'ingestion_promotion_sweep_duration_seconds',
    description:
      'Wall-clock duration of one promotion sweep per chain. One observation per chain per 30-s tick.',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  }),

  rpcRequestDuration: defineHistogram({
    name: 'ingestion_rpc_request_duration_seconds',
    description: 'Latency of individual JSON-RPC requests',
    // 7.5s bucket bridges per-attempt (4s) and overall (12s) timeouts
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 7.5, 10],
  }),
  batchDuration: defineHistogram({
    name: 'ingestion_batch_duration_seconds',
    description:
      'Wall-clock duration of one EventPoller batch through the ingester listener (decode + writer per event). One observation per batch.',
    // Buckets straddle the 12-s tick budget — operators alert on p95 ≥ 12 s.
    buckets: [0.1, 0.5, 1, 2, 4, 8, 12, 16, 30],
  }),
} as const;
