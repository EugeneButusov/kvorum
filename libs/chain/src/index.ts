export type { ChainConfig, ProviderConfig } from './config/config.js';
export { parseChainConfigFromEnv, normalizeChainId } from './config/config.js';

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

export { chainMetrics, sanitizeMethod } from './metrics/metrics.js';

export type {
  ResolutionResult,
  ResolutionStep,
  ResolutionReason,
  ProxyKind,
  ResolverOptions,
} from './proxy/types.js';
export { ProxyResolver } from './proxy/proxy-resolver.js';
export { STANDARD_PROXY_SLOTS } from './proxy/slots.js';

export type {
  ReorgSignal,
  ReorgListener,
  ReorgDetectorOptions,
  BufferResetSignal,
  BufferResetListener,
  BufferResetReason,
} from './reorg/types.js';
export { ReorgDetector } from './reorg/reorg-detector.js';

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
export { buildIdempotencyKey } from './poller/utils/idempotency.utils.js';

export { BackfillRangeFetcher } from './backfill/range-fetcher.js';
export type {
  BackfillRangeFetcherOptions,
  BackfillRangeFetcherResult,
} from './backfill/range-fetcher.js';
export { BackfillChunkTooSmallError } from './backfill/errors/backfill-chunk-too-small.error.js';

export type { ChainContext } from './chain-context-registry.js';
export { ChainContextRegistry } from './chain-context-registry.js';
export { reorgCutoff } from './reorg-cutoff.js';
