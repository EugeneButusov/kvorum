import type { JsonRpcProvider } from 'ethers';
import type { ChainConfig } from './config.js';
import { ChainConfigError } from './chain-config.error.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';
import type { ProviderState } from './provider-state.js';
import {
  getHealthCheckFailuresTotal,
  getProviderLagBlocks,
  getProviderUnusable,
  getProviderVerified,
} from './metrics.js';

const CHAIN_ID_RETRY_DELAYS_MS = [200, 600, 1800];
const HEALTH_CHECK_INTERVAL_MS = 30_000;

export interface HealthCheckerOptions {
  logger?: Logger;
  intervalMs?: number; // injectable for tests
}

export class HealthChecker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly lagThreshold: number;
  private readonly chainName: string;

  constructor(
    private readonly config: ChainConfig,
    private readonly states: Map<string, ProviderState>,
    private readonly providers: Map<string, JsonRpcProvider>,
    opts: HealthCheckerOptions = {},
  ) {
    this.logger = opts.logger ?? silentLogger;
    this.intervalMs = opts.intervalMs ?? HEALTH_CHECK_INTERVAL_MS;
    this.lagThreshold = config.lagThresholdBlocks ?? 3;
    this.chainName = config.name;
  }

  async start(): Promise<void> {
    if (this.stopped) return;
    await this.runInitialChainIdProbes();
    if (this.stopped) return;
    await this.pollBlockNumbers();
    if (this.stopped) return;
    this.scheduleRecurringPolls();
  }

  stop(): void {
    this.stopped = true;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private scheduleRecurringPolls(): void {
    this.intervalHandle = setInterval(() => {
      void this.pollBlockNumbers();
    }, this.intervalMs);
  }

  /** Probes eth_chainId per provider with bounded retry. Sets verified or unusable. */
  private async runInitialChainIdProbes(): Promise<void> {
    const chain = this.chainName;

    await Promise.all(
      [...this.states.entries()].map(async ([name, state]) => {
        const provider = this.providers.get(name);
        if (!provider) return;

        let verified = false;

        for (let attempt = 0; attempt <= CHAIN_ID_RETRY_DELAYS_MS.length; attempt++) {
          if (attempt > 0) {
            await sleep(CHAIN_ID_RETRY_DELAYS_MS[attempt - 1]!);
          }
          try {
            const raw = (await provider.send('eth_chainId', [])) as string;
            const reported = Number(BigInt(raw));
            if (reported !== this.config.chainId) {
              state.unusable = true;
              getProviderUnusable().set({ provider: name, chain }, 1);
              getProviderVerified().set({ provider: name, chain }, 0);
              this.logger.error(
                `[chain:${chain}] provider ${name} chainId mismatch: expected ${this.config.chainId}, got ${reported}`,
              );
              return;
            }
            verified = true;
            break;
          } catch {
            // retry or exhaust budget
          }
        }

        if (!verified) {
          state.unusable = true;
          getProviderUnusable().set({ provider: name, chain }, 1);
          getProviderVerified().set({ provider: name, chain }, 0);
          this.logger.error(
            `[chain:${chain}] provider ${name} chainId probe failed after ${CHAIN_ID_RETRY_DELAYS_MS.length + 1} attempts — marking unusable`,
          );
          return;
        }

        state.verified = true;
        getProviderVerified().set({ provider: name, chain }, 1);
        getProviderUnusable().set({ provider: name, chain }, 0);
        this.logger.info(`[chain:${chain}] provider ${name} chainId verified`);
      }),
    );

    const verifiedCount = [...this.states.values()].filter((s) => s.verified).length;
    if (verifiedCount === 0) {
      throw new ChainConfigError(
        `No providers verified for chain ${this.config.chainId} (${this.chainName}). All probes failed or mismatched.`,
      );
    }
  }

  /** Polls eth_blockNumber for all verified providers; updates lag/deprioritized. */
  private async pollBlockNumbers(): Promise<void> {
    const chain = this.chainName;
    const eligible = [...this.states.entries()].filter(([, s]) => s.verified && !s.unusable);

    const results = await Promise.allSettled(
      eligible.map(async ([name, state]) => {
        const provider = this.providers.get(name);
        if (!provider) return;
        try {
          const raw = (await provider.send('eth_blockNumber', [])) as string;
          const blockNumber = BigInt(raw);
          state.lastBlockNumber = blockNumber;
          state.lastHealthCheckAt = new Date();
          state.consecutiveHealthFailures = 0;
          return { name, blockNumber };
        } catch {
          state.consecutiveHealthFailures++;
          state.lastHealthCheckAt = new Date();
          getHealthCheckFailuresTotal().inc({ provider: name, chain });
          return;
        }
      }),
    );

    // Compute leader = highest block among successful responders
    let leader = 0n;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        if (r.value.blockNumber > leader) leader = r.value.blockNumber;
      }
    }

    // Update lag-based deprioritization
    for (const [name, state] of eligible) {
      if (state.lastBlockNumber === null) continue;
      const lag = leader - state.lastBlockNumber;
      getProviderLagBlocks().set({ provider: name, chain }, Number(lag));
      const wasDeprioritized = state.deprioritized;
      state.deprioritized = lag > BigInt(this.lagThreshold);
      if (state.deprioritized && !wasDeprioritized) {
        this.logger.warn(
          `[chain:${chain}] provider ${name} is ${lag} blocks behind leader — deprioritized`,
        );
      } else if (!state.deprioritized && wasDeprioritized) {
        this.logger.info(`[chain:${chain}] provider ${name} caught up — no longer deprioritized`);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
