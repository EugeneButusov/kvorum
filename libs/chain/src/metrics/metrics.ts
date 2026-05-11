import { Counter, Gauge, Histogram, Registry } from 'prom-client';

const registry = new Registry();

/** Methods allowed as the `method` label. Anything else is recorded as "other". */
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

// ---- lazy getOrCreate helpers ----

let rpcRequestsTotal: Counter | null = null;
export function getRpcRequestsTotal(): Counter {
  if (!rpcRequestsTotal) {
    rpcRequestsTotal = new Counter({
      name: 'kvorum_ingestion_rpc_requests_total',
      help: 'Total JSON-RPC requests dispatched by the failover client',
      labelNames: ['provider', 'chain', 'method', 'status'],
      registers: [registry],
    });
  }
  return rpcRequestsTotal;
}

let rpcFailuresTotal: Counter | null = null;
export function getRpcFailuresTotal(): Counter {
  if (!rpcFailuresTotal) {
    rpcFailuresTotal = new Counter({
      name: 'kvorum_ingestion_rpc_failures_total',
      help: 'Total failed JSON-RPC requests by error reason',
      labelNames: ['provider', 'chain', 'reason'],
      registers: [registry],
    });
  }
  return rpcFailuresTotal;
}

let circuitState: Gauge | null = null;
export function getCircuitState(): Gauge {
  if (!circuitState) {
    circuitState = new Gauge({
      name: 'kvorum_ingestion_circuit_state',
      help: 'Circuit breaker state per provider: 0=closed, 1=half-open, 2=open',
      labelNames: ['provider', 'chain'],
      registers: [registry],
    });
  }
  return circuitState;
}

let providerLagBlocks: Gauge | null = null;
export function getProviderLagBlocks(): Gauge {
  if (!providerLagBlocks) {
    providerLagBlocks = new Gauge({
      name: 'kvorum_ingestion_provider_lag_blocks',
      help: 'How many blocks behind the chain leader this provider is',
      labelNames: ['provider', 'chain'],
      registers: [registry],
    });
  }
  return providerLagBlocks;
}

let providerUnusable: Gauge | null = null;
export function getProviderUnusable(): Gauge {
  if (!providerUnusable) {
    providerUnusable = new Gauge({
      name: 'kvorum_ingestion_provider_unusable',
      help: '1 if the provider is unusable (chainId mismatch or probe-retry exhausted), 0 otherwise',
      labelNames: ['provider', 'chain'],
      registers: [registry],
    });
  }
  return providerUnusable;
}

let providerVerified: Gauge | null = null;
export function getProviderVerified(): Gauge {
  if (!providerVerified) {
    providerVerified = new Gauge({
      name: 'kvorum_ingestion_provider_verified',
      help: '1 if the provider has passed chainId verification, 0 otherwise',
      labelNames: ['provider', 'chain'],
      registers: [registry],
    });
  }
  return providerVerified;
}

let healthCheckFailuresTotal: Counter | null = null;
export function getHealthCheckFailuresTotal(): Counter {
  if (!healthCheckFailuresTotal) {
    healthCheckFailuresTotal = new Counter({
      name: 'kvorum_ingestion_health_check_failures_total',
      help: 'Total health check failures per provider',
      labelNames: ['provider', 'chain'],
      registers: [registry],
    });
  }
  return healthCheckFailuresTotal;
}

let rpcRequestDuration: Histogram | null = null;
export function getRpcRequestDuration(): Histogram {
  if (!rpcRequestDuration) {
    rpcRequestDuration = new Histogram({
      name: 'kvorum_ingestion_rpc_request_duration_seconds',
      help: 'Latency of individual JSON-RPC requests',
      labelNames: ['provider', 'chain', 'method'],
      // 7.5s bucket bridges per-attempt (4s) and overall (12s) timeouts
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 7.5, 10],
      registers: [registry],
    });
  }
  return rpcRequestDuration;
}

// ---- E3 ingestion metrics ----

let headBlockAgeSeconds: Gauge | null = null;
export function getHeadBlockAgeSeconds(): Gauge {
  if (!headBlockAgeSeconds) {
    headBlockAgeSeconds = new Gauge({
      name: 'kvorum_ingestion_head_block_age_seconds',
      help: 'Wall-clock minus chain-reported timestamp of last observed head. NTP skew can produce false-positive stale-source alarms; alert threshold should be generous (>60s).',
      labelNames: ['chain'],
      registers: [registry],
    });
  }
  return headBlockAgeSeconds;
}

let headPollLagSeconds: Gauge | null = null;
export function getHeadPollLagSeconds(): Gauge {
  if (!headPollLagSeconds) {
    headPollLagSeconds = new Gauge({
      name: 'kvorum_ingestion_head_poll_lag_seconds',
      help: 'Wall-clock minus last successful head-poll completion. Stalled-poller alarm.',
      labelNames: ['chain'],
      registers: [registry],
    });
  }
  return headPollLagSeconds;
}

let logPollLagSeconds: Gauge | null = null;
export function getLogPollLagSeconds(): Gauge {
  if (!logPollLagSeconds) {
    logPollLagSeconds = new Gauge({
      name: 'kvorum_ingestion_log_poll_lag_seconds',
      help: 'Wall-clock minus last successful log-poll completion per dao_source. Backs SPEC §6.20.2 ingestion-lag alert.',
      labelNames: ['chain', 'dao_source'],
      registers: [registry],
    });
  }
  return logPollLagSeconds;
}

let logsFetchedTotal: Counter | null = null;
export function getLogsFetchedTotal(): Counter {
  if (!logsFetchedTotal) {
    logsFetchedTotal = new Counter({
      name: 'kvorum_ingestion_logs_fetched_total',
      help: 'Total logs returned by eth_getLogs (re-fetches counted; not de-duped events).',
      labelNames: ['chain', 'dao_source'],
      registers: [registry],
    });
  }
  return logsFetchedTotal;
}

let logPollWindowBlocks: Gauge | null = null;
export function getLogPollWindowBlocks(): Gauge {
  if (!logPollWindowBlocks) {
    logPollWindowBlocks = new Gauge({
      name: 'kvorum_ingestion_log_poll_window_blocks',
      help: 'Current window size in blocks. Diagnostic; constant in v1 (2 × reorgHorizon).',
      labelNames: ['chain', 'dao_source'],
      registers: [registry],
    });
  }
  return logPollWindowBlocks;
}

let logsWithRemovedFlagTotal: Counter | null = null;
export function getLogsWithRemovedFlagTotal(): Counter {
  if (!logsWithRemovedFlagTotal) {
    logsWithRemovedFlagTotal = new Counter({
      name: 'kvorum_ingestion_logs_with_removed_flag_total',
      help: 'Count of logs ethers v6 marks removed:true. Diagnostic for in-fetch reorg windows.',
      labelNames: ['chain', 'dao_source'],
      registers: [registry],
    });
  }
  return logsWithRemovedFlagTotal;
}

// ---- E4 metrics ----

let reorgSignalsTotal: Counter | null = null;
export function getReorgSignalsTotal(): Counter {
  if (!reorgSignalsTotal) {
    reorgSignalsTotal = new Counter({
      name: 'kvorum_ingestion_reorg_signals_total',
      help: 'Reorg signals emitted by the in-process detector. Each signal corresponds to one parent-hash mismatch, head drop, or chain-shrink event. F2 records the persistent reorg_event row.',
      labelNames: ['chain'],
      registers: [registry],
    });
  }
  return reorgSignalsTotal;
}

let proxyResolutionsTotal: Counter | null = null;
export function getProxyResolutionsTotal(): Counter {
  if (!proxyResolutionsTotal) {
    proxyResolutionsTotal = new Counter({
      name: 'kvorum_ingestion_proxy_resolutions_total',
      help: 'Proxy resolution outcomes. result=resolved|not_a_proxy|capped|cycle|all_slots_failed.',
      labelNames: ['chain', 'result'],
      registers: [registry],
    });
  }
  return proxyResolutionsTotal;
}

// ---- F1 archive / ingestion metrics ----

let pendingEventCount: Gauge | null = null;
export function getPendingEventCount(): Gauge {
  if (!pendingEventCount) {
    pendingEventCount = new Gauge({
      name: 'kvorum_ingestion_pending_event_count',
      help: 'Count of archive_confirmation rows in pending state per chain × source_type. Updated by periodic recalculation, not per-write.',
      labelNames: ['chain_id', 'source_type'],
      registers: [registry],
    });
  }
  return pendingEventCount;
}

let archiveWritesTotal: Counter | null = null;
export function getArchiveWritesTotal(): Counter {
  if (!archiveWritesTotal) {
    archiveWritesTotal = new Counter({
      name: 'kvorum_ingestion_archive_writes_total',
      help: 'Archive write outcomes by source. result=inserted|skipped_existing|skipped_conflict|pg_dlq_routed. CH errors → kvorum_archive_ch_write_errors_total; decode errors → kvorum_archive_decode_errors_total; pg_unreachable → kvorum_dual_write_pg_unreachable_total.',
      labelNames: ['source', 'result'],
      registers: [registry],
    });
  }
  return archiveWritesTotal;
}

let archiveSkippedExistenceTotal: Counter | null = null;
export function getArchiveSkippedExistenceTotal(): Counter {
  if (!archiveSkippedExistenceTotal) {
    archiveSkippedExistenceTotal = new Counter({
      name: 'kvorum_archive_skipped_existence_total',
      help: 'PG-first existence check hits (ADR-041 step 1). Increments when an event was already persisted.',
      labelNames: ['source'],
      registers: [registry],
    });
  }
  return archiveSkippedExistenceTotal;
}

let archiveChWriteErrorsTotal: Counter | null = null;
export function getArchiveChWriteErrorsTotal(): Counter {
  if (!archiveChWriteErrorsTotal) {
    archiveChWriteErrorsTotal = new Counter({
      name: 'kvorum_archive_ch_write_errors_total',
      help: 'CH-insert failures per source. Listener catches per-event; batch continues. Next 12-s tick retries via step 1.',
      labelNames: ['source'],
      registers: [registry],
    });
  }
  return archiveChWriteErrorsTotal;
}

let archiveDecodeErrorsTotal: Counter | null = null;
export function getArchiveDecodeErrorsTotal(): Counter {
  if (!archiveDecodeErrorsTotal) {
    archiveDecodeErrorsTotal = new Counter({
      name: 'kvorum_archive_decode_errors_total',
      help: 'DecodeError occurrences per source. reason=unknown_topic|parse_failed|wrong_address.',
      labelNames: ['source', 'reason'],
      registers: [registry],
    });
  }
  return archiveDecodeErrorsTotal;
}

let dualWritePgUnreachableTotal: Counter | null = null;
export function getDualWritePgUnreachableTotal(): Counter {
  if (!dualWritePgUnreachableTotal) {
    dualWritePgUnreachableTotal = new Counter({
      name: 'kvorum_dual_write_pg_unreachable_total',
      help: 'PG unreachable for the DLQ insert itself (ADR-041 step 5). Single source of truth for this failure mode.',
      labelNames: ['source'],
      registers: [registry],
    });
  }
  return dualWritePgUnreachableTotal;
}

let indexerActiveSources: Gauge | null = null;
export function getIndexerActiveSources(): Gauge {
  if (!indexerActiveSources) {
    indexerActiveSources = new Gauge({
      name: 'kvorum_indexer_active_sources',
      help: 'Count of dao_source rows the indexer booted with per source_type. Zero is a deployable-but-actionable signal (misconfigured table).',
      labelNames: ['source_type'],
      registers: [registry],
    });
  }
  return indexerActiveSources;
}

let batchDurationSeconds: Histogram | null = null;
export function getBatchDurationSeconds(): Histogram {
  if (!batchDurationSeconds) {
    batchDurationSeconds = new Histogram({
      name: 'kvorum_ingestion_batch_duration_seconds',
      help: 'Wall-clock duration of one EventPoller batch through the ingester listener (decode + writer per event). One observation per batch.',
      labelNames: ['source'],
      // Buckets straddle the 12-s tick budget — operators alert on p95 ≥ 12 s.
      buckets: [0.1, 0.5, 1, 2, 4, 8, 12, 16, 30],
      registers: [registry],
    });
  }
  return batchDurationSeconds;
}

/** Reset all lazy metric instances. Required between test cases to avoid registration conflicts. */
export function resetMetrics(): void {
  registry.clear(); // fully unregisters metrics so getOrCreate* can re-register safely
  rpcRequestsTotal = null;
  rpcFailuresTotal = null;
  circuitState = null;
  providerLagBlocks = null;
  providerUnusable = null;
  providerVerified = null;
  healthCheckFailuresTotal = null;
  rpcRequestDuration = null;
  headBlockAgeSeconds = null;
  headPollLagSeconds = null;
  logPollLagSeconds = null;
  logsFetchedTotal = null;
  logPollWindowBlocks = null;
  logsWithRemovedFlagTotal = null;
  reorgSignalsTotal = null;
  proxyResolutionsTotal = null;
  pendingEventCount = null;
  archiveWritesTotal = null;
  archiveSkippedExistenceTotal = null;
  archiveChWriteErrorsTotal = null;
  archiveDecodeErrorsTotal = null;
  dualWritePgUnreachableTotal = null;
  indexerActiveSources = null;
  batchDurationSeconds = null;
}

export function getChainMetricsRegistry(): Registry {
  return registry;
}
