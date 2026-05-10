import type { JsonRpcProvider } from 'ethers';
import type { ChainConfig } from '../config/config.js';
import type { Logger } from '../logger.js';
import type { ProviderState } from './provider-state.js';
import { AllProvidersFailedError } from '../errors/all-providers-failed.error.js';
import { ClientStoppedError } from '../errors/client-stopped.error.js';
import { DeadlineError } from '../errors/deadline.error.js';
import { categorizeError, scrubError, type ErrorReason } from '../errors/errors.js';
import { HealthChecker, type HealthCheckerOptions } from '../health/health-checker.js';
import {
  getCircuitState,
  getRpcFailuresTotal,
  getRpcRequestDuration,
  getRpcRequestsTotal,
  sanitizeMethod,
} from '../metrics/metrics.js';
import { createJsonRpcProvider } from './provider-factory.js';
import { createProviderState } from './provider-state.js';
import { silentLogger } from '../logger.js';

export interface RpcSendOptions {
  deadlineMs?: number;
}

export interface RpcClientHealth {
  chainId: number;
  providers: Array<
    Readonly<ProviderState> & {
      circuitState: 'closed' | 'open' | 'half-open';
    }
  >;
}

export interface RpcClient {
  send<T = unknown>(method: string, params: unknown[], opts?: RpcSendOptions): Promise<T>;
  getHealth(): RpcClientHealth;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ProviderEntry {
  config: ChainConfig['providers'][number];
  state: ProviderState;
  provider: JsonRpcProvider;
}

export interface FailoverRpcClientOptions {
  logger?: Logger;
  healthChecker?: HealthCheckerOptions;
}

export class FailoverRpcClient implements RpcClient {
  private readonly entries: ProviderEntry[];
  private readonly chainName: string;
  private readonly defaultDeadlineMs: number;
  private stopped = false;
  private readonly logger: Logger;
  private readonly healthChecker: HealthChecker;

  constructor(
    private readonly config: ChainConfig,
    opts: FailoverRpcClientOptions = {},
  ) {
    this.chainName = config.name;
    this.defaultDeadlineMs = config.overallTimeoutMs ?? 12_000;
    this.logger = opts.logger ?? silentLogger;

    this.entries = config.providers
      .slice()
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
      .map((providerConfig) => ({
        config: providerConfig,
        state: createProviderState(providerConfig.name),
        provider: createJsonRpcProvider(providerConfig, config.chainId),
      }));

    const statesMap = this.getProviderStates();
    const providersMap = new Map(this.entries.map((e) => [e.config.name, e.provider]));
    this.healthChecker = new HealthChecker(config, statesMap, providersMap, {
      logger: this.logger,
      ...opts.healthChecker,
    });
  }

  /** Exposed so HealthChecker can wire into the shared state map. */
  getProviderStates(): Map<string, ProviderState> {
    const m = new Map<string, ProviderState>();
    for (const e of this.entries) m.set(e.config.name, e.state);
    return m;
  }

  getHealth(): RpcClientHealth {
    return {
      chainId: this.config.chainId,
      providers: this.entries.map((e) => ({
        ...e.state,
        circuitState: e.state.circuit.getState(),
      })),
    };
  }

  async start(): Promise<void> {
    await this.healthChecker.start();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.healthChecker.stop();
    for (const e of this.entries) {
      e.provider.destroy();
    }
  }

  async send<T = unknown>(method: string, params: unknown[], opts?: RpcSendOptions): Promise<T> {
    if (this.stopped) throw new ClientStoppedError(this.config.chainId);

    const deadlineMs = opts?.deadlineMs ?? this.defaultDeadlineMs;
    const deadlineStart = Date.now();

    const attempts: Array<{ provider: string; reason: ErrorReason; cause: unknown }> = [];

    // Two passes: prefer non-deprioritized, fall through to deprioritized if all exhaust
    const passes = [
      this.entries.filter((e) => e.state.verified && !e.state.unusable && !e.state.deprioritized),
      this.entries.filter((e) => e.state.verified && !e.state.unusable && e.state.deprioritized),
    ];

    const sanitized = sanitizeMethod(method);
    const chain = this.chainName;

    for (const candidates of passes) {
      for (const entry of candidates) {
        const { state, provider, config: providerCfg } = entry;

        const elapsed = Date.now() - deadlineStart;
        const remaining = deadlineMs - elapsed;
        if (remaining <= 0) break;

        if (!state.circuit.tryAcquire()) continue;

        const startMs = Date.now();

        let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
        const deadlinePromise = new Promise<never>((_, reject) => {
          deadlineTimer = setTimeout(() => reject(new DeadlineError()), remaining);
        });

        // Capture the in-flight ethers promise so a late rejection (after the deadline
        // wins the race) gets a no-op handler — otherwise it surfaces as unhandledRejection
        // and crashes the process under Node's default policy.
        const inFlight = provider.send(method, params) as Promise<T>;
        inFlight.catch(() => {});

        try {
          const result = await Promise.race([inFlight, deadlinePromise]);

          clearTimeout(deadlineTimer!);

          const durationS = (Date.now() - startMs) / 1000;
          state.circuit.recordSuccess();
          getRpcRequestsTotal().inc({
            provider: providerCfg.name,
            chain,
            method: sanitized,
            status: 'success',
          });
          getRpcRequestDuration().observe(
            { provider: providerCfg.name, chain, method: sanitized },
            durationS,
          );
          getCircuitState().set(
            { provider: providerCfg.name, chain },
            circuitStateValue(state.circuit.getState()),
          );

          return result;
        } catch (err) {
          clearTimeout(deadlineTimer!);

          // stopped check BEFORE categorizeError/recordFailure to avoid spurious breaker ticks
          if (this.stopped) throw new ClientStoppedError(this.config.chainId);

          if (err instanceof DeadlineError) {
            // Release any half-open probe slot we claimed — request never completed,
            // so success/failure semantics don't apply.
            state.circuit.recordAbandoned();
            attempts.push({
              provider: providerCfg.name,
              reason: 'timeout',
              cause: scrubError(err),
            });
            break; // deadline expired — stop trying
          }

          const cat = categorizeError(err);

          if (cat === 'transparent') {
            // Caller-scoped error (method not found, invalid params, etc.) — rethrow without breaker tick
            throw err;
          }

          const durationS = (Date.now() - startMs) / 1000;
          state.circuit.recordFailure();
          getRpcRequestsTotal().inc({
            provider: providerCfg.name,
            chain,
            method: sanitized,
            status: 'failure',
          });
          getRpcFailuresTotal().inc({ provider: providerCfg.name, chain, reason: cat });
          getRpcRequestDuration().observe(
            { provider: providerCfg.name, chain, method: sanitized },
            durationS,
          );
          getCircuitState().set(
            { provider: providerCfg.name, chain },
            circuitStateValue(state.circuit.getState()),
          );

          attempts.push({ provider: providerCfg.name, reason: cat, cause: scrubError(err) });

          this.logger.warn(
            `[chain:${chain}] provider ${providerCfg.name} failed (${cat}), trying next`,
          );
        }
      }
    }

    throw new AllProvidersFailedError(this.config.chainId, attempts);
  }
}

function circuitStateValue(state: 'closed' | 'open' | 'half-open'): number {
  if (state === 'closed') return 0;
  if (state === 'half-open') return 1;
  return 2;
}

export function createFailoverRpcClient(
  config: ChainConfig,
  opts?: FailoverRpcClientOptions,
): RpcClient {
  return new FailoverRpcClient(config, opts);
}
