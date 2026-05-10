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
}

export function getChainMetricsRegistry(): Registry {
  return registry;
}
