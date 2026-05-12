import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { parseChainConfigFromEnv } from '@libs/chain';
import { chainMetrics } from '@libs/chain';
import type { ChainConfig } from '@libs/chain';
import { ConfirmationRepository, DaoSourceRepository } from '@libs/db';
import type { SourcePlugin } from '@sources/core';
import { ChainContextRegistry } from './chain-context-registry';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';
import { SOURCE_PLUGINS, FETCH_DRIVERS } from './tokens';

@Injectable()
export class IndexerOrchestratorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('IndexerOrchestrator');
  private readonly handles: FetchDriverHandle[] = [];
  private gaugeInterval: ReturnType<typeof setInterval> | null = null;
  private activeSourceTypes: Set<string> = new Set();

  constructor(
    @Inject(SOURCE_PLUGINS) private readonly plugins: ReadonlyArray<SourcePlugin>,
    @Inject(FETCH_DRIVERS) private readonly driver: FetchDriver,
    private readonly daoSourceRepo: DaoSourceRepository,
    private readonly confirmationRepo: ConfirmationRepository,
    private readonly registry: ChainContextRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  private async start(): Promise<void> {
    const chains = parseChainConfigFromEnv(process.env);
    const chainsByChainId = new Map<string, ChainConfig>(chains.map((c) => [c.chainId, c]));
    const pluginsByType = new Map(this.plugins.map((p) => [p.sourceType, p]));
    const driversByKind = new Map([[this.driver.kind, this.driver]]);

    const sources = await this.daoSourceRepo.findAll();

    if (sources.length === 0) {
      this.logger.warn('No dao_source rows found; indexer will idle');
      this.registry.markReady();
      return;
    }

    // Pre-validate ALL rows before starting any driver (fail-fast, no partial startup leaks)
    const validated: Array<{
      sourceType: string;
      config: unknown;
      plugin: SourcePlugin;
      chainCfg: ChainConfig;
      src: (typeof sources)[number];
    }> = [];

    for (const src of sources) {
      const plugin = pluginsByType.get(src.source_type);
      if (!plugin) {
        const err = new Error(
          `No plugin registered for source_type="${src.source_type}" (dao_source ${src.id})`,
        );
        this.registry.markFailed(err);
        throw err;
      }
      const chainCfg = chainsByChainId.get(src.primary_chain_id);
      if (!chainCfg) {
        const err = new Error(
          `dao_source ${src.id} is on chain ${src.primary_chain_id} but CHAIN_CONFIG has no entry for it`,
        );
        this.registry.markFailed(err);
        throw err;
      }
      const config = plugin.parseConfig(src.source_config);
      validated.push({ sourceType: src.source_type, config, plugin, chainCfg, src });
    }

    // Start drivers; on failure drain everything already started
    try {
      for (const entry of validated) {
        const ctx = {
          daoSourceId: entry.src.id,
          sourceType: entry.sourceType,
          chainId: entry.src.primary_chain_id,
          sourceLabel: entry.sourceType,
        };
        const spec = entry.plugin.buildIngestSpec(ctx, entry.config);
        const driver = driversByKind.get(spec.kind);
        if (!driver) {
          throw new Error(`No FetchDriver registered for IngestSpec.kind="${spec.kind}"`);
        }
        const handle = await (driver as FetchDriver<typeof spec.kind>).start(
          spec as never,
          ctx,
          entry.chainCfg,
        );
        this.handles.push(handle);
        this.activeSourceTypes.add(entry.sourceType);
      }
    } catch (err) {
      this.logger.error('bootstrap_failed_cleanup', { error: String(err) });
      await Promise.allSettled(this.handles.map((h) => h.stop()));
      this.handles.length = 0;
      this.activeSourceTypes.clear();
      this.registry.markFailed(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }

    for (const [sourceType, count] of countBySourceType(validated.map((v) => v.sourceType))) {
      chainMetrics.indexerActiveSources.record(count, { source_type: sourceType });
    }
    this.logger.log(
      `started ${sources.length} source(s) across ${new Set(validated.map((v) => v.chainCfg.chainId)).size} chain(s)`,
    );

    this.registry.markReady();
    this.startPendingDepthGauge();
  }

  async drain(): Promise<void> {
    if (this.gaugeInterval !== null) {
      clearInterval(this.gaugeInterval);
      this.gaugeInterval = null;
    }
    await Promise.allSettled(this.handles.map((h) => h.stop()));
    this.handles.length = 0;
    this.activeSourceTypes.clear();
    await this.registry.drainAll();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  private startPendingDepthGauge(): void {
    const update = async () => {
      try {
        for (const sourceType of this.activeSourceTypes) {
          const rows = await this.confirmationRepo.countPendingBySourceType(sourceType);
          for (const row of rows) {
            chainMetrics.pendingEventCount.record(Number(row.count), {
              chain_id: row.chain_id,
              source_type: row.source_type,
            });
          }
        }
      } catch (err) {
        this.logger.warn('pending_depth_gauge_error', { error: String(err) });
      }
    };

    this.gaugeInterval = setInterval(() => {
      void update();
    }, 10_000);
  }
}

function countBySourceType(types: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of types) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}
