export type { ChainConfig, ProviderConfig } from './config.js';
export { parseChainConfigFromEnv } from './config.js';

export type {
  RpcClient,
  RpcClientHealth,
  RpcSendOptions,
  FailoverRpcClientOptions,
} from './failover-rpc-client.js';
export { createFailoverRpcClient, FailoverRpcClient } from './failover-rpc-client.js';

export type { Logger } from './logger.js';
export { consoleLogger, silentLogger } from './logger.js';

export type { CircuitBreakerState } from './circuit-breaker.js';
export { CircuitBreaker } from './circuit-breaker.js';

export type { ProviderState } from './provider-state.js';

export type { ErrorReason } from './errors.js';
export { categorizeError, scrubError } from './errors.js';

export { AllProvidersFailedError } from './all-providers-failed.error.js';
export { ChainConfigError } from './chain-config.error.js';
export { ClientStoppedError } from './client-stopped.error.js';
export { NotImplementedError } from './not-implemented.error.js';

export { getChainMetricsRegistry, resetMetrics } from './metrics.js';
