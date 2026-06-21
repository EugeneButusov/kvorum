import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import {
  ChainContextRegistry,
  parseChainConfigFromEnv,
  chainMetrics,
  silentLogger,
  readConfirmedHead,
} from '@libs/chain';
import type { ChainConfig } from '@libs/chain';
import { ArchiveEventRepository, DaoSourceRepository } from '@libs/db';
import { raceWithAbort, AbortError } from '@libs/utils';
import {
  BackfillAlreadyStartedError,
  runBootCatchUp,
  BootCatchUpShutdownError,
  SOURCE_INGESTERS,
  type SourceIngester,
  type SourceContext,
  type IngestSpec,
} from '@sources/core';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';
import { orchestratorMetrics } from './orchestrator-metrics';
import { FETCH_DRIVERS } from './tokens';

@Injectable()
export class IndexerOrchestratorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('IndexerOrchestrator');
  private readonly handles: FetchDriverHandle[] = [];
  private gaugeInterval: ReturnType<typeof setInterval> | null = null;
  private activeSourceTypes: Set<string> = new Set();
  private activeSources: Array<{ daoSourceId: string; chainCfg: ChainConfig }> = [];
  private shutdownController = new AbortController();
  private catchUpTasks: Promise<void>[] = [];

  constructor(
    @Inject(SOURCE_INGESTERS) private readonly plugins: ReadonlyArray<SourceIngester>,
    @Inject(FETCH_DRIVERS) private readonly drivers: readonly FetchDriver[],
    private readonly daoSourceRepo: DaoSourceRepository,
    private readonly archiveEventRepo: ArchiveEventRepository,
    private readonly registry: ChainContextRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  private async start(): Promise<void> {
    const pollerEnabled = (process.env['INDEXER_LIVE_POLLER_ENABLED'] ?? 'true') !== 'false';
    this.logger.log(`live_poller_enabled=${String(pollerEnabled)}`);

    if (!pollerEnabled) {
      this.logger.log(
        'Live EventPoller disabled (INDEXER_LIVE_POLLER_ENABLED=false); derivation/decode/promotion/reorg still active',
      );
      return;
    }

    const chains = parseChainConfigFromEnv(process.env);
    const chainsByChainId = new Map<string, ChainConfig>(chains.map((c) => [c.chainId, c]));
    const pluginsByType = new Map(this.plugins.map((p) => [p.sourceType, p]));
    const driversByKind = new Map(this.drivers.map((d) => [d.kind, d]));

    const sources = await this.daoSourceRepo.findAll();

    if (sources.length === 0) {
      this.logger.warn('No dao_source rows found; indexer will idle');
      return;
    }

    // Pre-validate ALL rows before starting any driver (fail-fast, no partial startup leaks).
    // buildIngestSpec is called here so we can gate the chain-config lookup on spec.kind.
    const validated: Array<{
      sourceType: string;
      config: unknown;
      plugin: SourceIngester;
      /** undefined for poll specs — they carry no chain context. */
      chainCfg: ChainConfig | undefined;
      spec: IngestSpec;
      ctx: SourceContext;
      src: (typeof sources)[number];
    }> = [];

    for (const src of sources) {
      const plugin = pluginsByType.get(src.source_type);
      if (!plugin) {
        // ADR-0073: a dao_source whose source_type has no registered plugin is seeded ahead of
        // its plugin (e.g. Z5 seeds snapshot/discourse_forum before AD1/AE2 build them). Skip it
        // with a warn + metric rather than crashing all ingestion. dao_source.source_type is
        // FK-constrained to source_type(value), so this can only be "not built yet" or a forgotten
        // plugin registration — the metric makes the latter alertable. (Distinct from the
        // intentionally-silent chain-unsupported skip below.)
        this.logger.warn('dao_source_no_plugin', {
          source_type: src.source_type,
          dao_source_id: src.id,
        });
        orchestratorMetrics.daoSourceUnregistered.add(1, { source_type: src.source_type });
        continue;
      }
      if (!plugin.supportedChainIds.includes(src.chain_id)) {
        continue;
      }
      const config = plugin.parseConfig(src.source_config);
      const ctx: SourceContext = {
        daoSourceId: src.id,
        sourceType: src.source_type,
        chainId: src.chain_id,
        sourceLabel: src.source_type,
      };
      const spec = plugin.buildIngestSpec(ctx, config);

      // Poll specs carry no chain context — skip the ChainConfig gate for them.
      let chainCfg: ChainConfig | undefined;
      if (spec.kind !== 'poll') {
        chainCfg = chainsByChainId.get(src.chain_id);
        if (!chainCfg) {
          throw new Error(
            `No chain config for chain_id="${src.chain_id}" (dao_source ${src.id}); add it to CHAIN_CONFIG`,
          );
        }
      }

      validated.push({ sourceType: src.source_type, config, plugin, chainCfg, spec, ctx, src });
    }

    // Start drivers; on failure drain everything already started
    try {
      for (const entry of validated) {
        const { spec, ctx } = entry;
        const driver = driversByKind.get(spec.kind);
        if (!driver) {
          throw new Error(`No FetchDriver registered for IngestSpec.kind="${spec.kind}"`);
        }

        let handle: FetchDriverHandle;
        if (spec.kind === 'poll') {
          handle = await (driver as FetchDriver<'poll'>).start(spec, ctx);
        } else {
          let resolveFirstTick: ((head: bigint) => void) | undefined;
          const firstTickPromise = new Promise<bigint>((resolve) => {
            resolveFirstTick = resolve;
          });
          handle = await (driver as FetchDriver<typeof spec.kind>).start(
            spec as never,
            ctx,
            entry.chainCfg!,
            spec.kind === 'evm-event-poller'
              ? { onFirstHeadComplete: resolveFirstTick }
              : undefined,
          );
          if (spec.kind === 'evm-event-poller') {
            const runtime = entry.plugin.buildBackfillRuntime(ctx, entry.config);
            const task = this.runParallelCatchUp(
              entry as typeof entry & { chainCfg: ChainConfig },
              runtime,
              firstTickPromise,
            );
            this.catchUpTasks.push(task);
          }
        }

        this.handles.push(handle);
        this.activeSourceTypes.add(entry.sourceType);
      }
    } catch (err) {
      this.logger.error('bootstrap_failed_cleanup', { error: String(err) });
      this.shutdownController.abort('bootstrap_failed_cleanup');
      await Promise.allSettled(this.catchUpTasks);
      this.catchUpTasks = [];
      await Promise.allSettled(this.handles.map((h) => h.stop()));
      this.handles.length = 0;
      this.activeSourceTypes.clear();
      await this.registry.drainAll();
      throw err;
    }

    for (const [sourceType, count] of countBySourceType(validated.map((v) => v.sourceType))) {
      chainMetrics.indexerActiveSources.record(count, { source_type: sourceType });
    }
    const evmChainIds = new Set(validated.flatMap((v) => (v.chainCfg ? [v.chainCfg.chainId] : [])));
    this.logger.log(`started ${validated.length} source(s) across ${evmChainIds.size} chain(s)`);

    // Only EVM sources contribute to the confirmed-head lag gauge (requires a chain context).
    this.activeSources = validated
      .filter((v): v is typeof v & { chainCfg: ChainConfig } => v.chainCfg != null)
      .map((v) => ({ daoSourceId: v.src.id, chainCfg: v.chainCfg }));
    this.startPendingDepthGauge();
  }

  async drain(): Promise<void> {
    this.shutdownController.abort('drain');
    if (this.gaugeInterval !== null) {
      clearInterval(this.gaugeInterval);
      this.gaugeInterval = null;
    }
    await Promise.allSettled(this.catchUpTasks);
    this.catchUpTasks = [];
    await Promise.allSettled(this.handles.map((h) => h.stop()));
    this.handles.length = 0;
    this.activeSourceTypes.clear();
    this.activeSources = [];
    await this.registry.drainAll();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shutdownController.abort('shutdown');
    await this.drain();
  }

  private startPendingDepthGauge(): void {
    const update = async () => {
      try {
        for (const sourceType of this.activeSourceTypes) {
          const rows = await this.archiveEventRepo.countUnderivedBySourceType(sourceType);
          for (const row of rows) {
            chainMetrics.underivedDepth.record(Number(row.count), {
              chain_id: row.chain_id,
              source_type: row.source_type,
            });
          }
        }
      } catch (err) {
        this.logger.warn('underived_depth_gauge_error', { error: String(err) });
      }

      for (const { daoSourceId, chainCfg } of this.activeSources) {
        try {
          const chainCtx = await this.registry.getOrCreate(chainCfg);
          const confirmedHead = await readConfirmedHead(chainCtx.client, chainCfg, daoSourceId);
          const maxBlock = await this.archiveEventRepo.findMaxBlockNumber(daoSourceId);
          if (maxBlock != null) {
            chainMetrics.archiveWriteLag.record(Number(confirmedHead) - Number(maxBlock), {
              chain_id: chainCfg.chainId,
              dao_source: daoSourceId,
            });
          }
        } catch (err) {
          this.logger.warn('archive_write_lag_gauge_error', {
            dao_source: daoSourceId,
            error: String(err),
          });
        }
      }
    };

    this.gaugeInterval = setInterval(() => {
      void update();
    }, 10_000);
  }

  private async runParallelCatchUp(
    entry: {
      chainCfg: ChainConfig;
      src: { id: string };
      sourceType: string;
    },
    runtime: ReturnType<SourceIngester['buildBackfillRuntime']>,
    firstTickPromise: Promise<bigint>,
  ): Promise<void> {
    try {
      const firstTickHead = await raceWithAbort(firstTickPromise, this.shutdownController.signal);
      const chainCtx = await this.registry.getOrCreate(entry.chainCfg);
      const result = await runBootCatchUp({
        daoSourceId: entry.src.id,
        chainConfig: entry.chainCfg,
        rpcClient: chainCtx.client,
        daoSourceRepo: this.daoSourceRepo,
        runtime,
        logger: silentLogger,
        signal: this.shutdownController.signal,
        toBlock: firstTickHead,
      });
      if (result.status === 'cancelled' && this.shutdownController.signal.aborted) {
        throw new BootCatchUpShutdownError();
      }
      if (result.status === 'error') {
        throw result.error;
      }
      if (result.status === 'skipped') {
        chainMetrics.ingestionGapFillSkipped.add(1, {
          chain: entry.chainCfg.name,
          dao_source: entry.src.id,
          reason: result.reason,
        });
      }
    } catch (error) {
      if (error instanceof AbortError || error instanceof BootCatchUpShutdownError) return;
      if (error instanceof BackfillAlreadyStartedError) {
        this.logger.warn('boot_catch_up_already_started_skip', {
          dao_source: entry.src.id,
          chain_id: entry.chainCfg.chainId,
          error: error.message,
        });
        return;
      }
      chainMetrics.ingestionGapFillFailed.add(1, {
        chain: entry.chainCfg.name,
        dao_source: entry.src.id,
        reason: 'error',
      });
      this.logger.error('boot_catch_up_failed', {
        source: entry.sourceType,
        dao_source: entry.src.id,
        error: String(error),
      });
    }
  }
}

function countBySourceType(types: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of types) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}
