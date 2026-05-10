import { Counter, Gauge, Histogram, Registry } from 'prom-client';

const registry = new Registry();

/** Methods allowed as the `method` label. Anything else is recorded as "other". */
const ALLOWED_METHODS = new Set([
  'eth_blockNumber',
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
}

export function getChainMetricsRegistry(): Registry {
  return registry;
}
