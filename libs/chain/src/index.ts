export type { ChainConfig, ProviderConfig } from './config/config.js';
export { parseChainConfigFromEnv } from './config/config.js';

export type { RpcClient, RpcClientHealth, RpcSendOptions } from './client/rpc-client.js';
export type { FailoverRpcClientOptions } from './client/failover-rpc-client.js';
export { createFailoverRpcClient, FailoverRpcClient } from './client/failover-rpc-client.js';

export type { Logger } from './logger.js';
export { consoleLogger, silentLogger } from './logger.js';

export type { CircuitBreakerState } from './breaker/circuit-breaker.js';
export { CircuitBreaker } from './breaker/circuit-breaker.js';

export type { ProviderState } from './client/provider-state.js';

export type { ErrorReason } from './errors/errors.js';
export { categorizeError, scrubError } from './errors/errors.js';

export { AllProvidersFailedError } from './errors/all-providers-failed.error.js';
export { ChainConfigError } from './errors/chain-config.error.js';
export { ClientStoppedError } from './errors/client-stopped.error.js';
export { NotImplementedError } from './errors/not-implemented.error.js';

export { getChainMetricsRegistry, resetMetrics } from './metrics/metrics.js';

export type {
  LogEvent,
  LogFilter,
  Head,
  HeadListener,
  EventsListener,
  EventPollerOptions,
  HeadTrackerOptions,
} from './poller/types.js';
export { EventPoller } from './poller/event-poller.js';
export { HeadTracker } from './poller/head-tracker.js';
export { buildIdempotencyKey } from './poller/idempotency.js';
