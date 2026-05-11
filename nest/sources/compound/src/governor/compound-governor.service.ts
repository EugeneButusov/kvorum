import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { z } from 'zod';
import {
  parseChainConfigFromEnv,
  EventPoller,
  FailoverRpcClient,
  type ChainConfig,
} from '@libs/chain';
import { getIndexerActiveSources, getPendingEventCount } from '@libs/chain';
import { ConfirmationRepository, DaoSourceRepository, DlqRepository } from '@libs/db';
import { ArchiveWriter, makeIngesterListener, COMPOUND_EVENT_TOPICS } from '@sources/compound';
import { toChainLogger } from '../utils/nest-logger-adapter';

const DaoSourceConfigSchema = z.object({
  governor_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
type DaoSourceConfig = z.infer<typeof DaoSourceConfigSchema>;

@Injectable()
export class CompoundGovernorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CompoundGovernor');
  private readonly pollers: EventPoller[] = [];
  private readonly clients: FailoverRpcClient[] = [];
  private gaugeInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly archiveWriter: ArchiveWriter,
    private readonly daoSourceRepo: DaoSourceRepository,
    private readonly confirmationRepo: ConfirmationRepository,
    private readonly dlqRepo: DlqRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const chains = parseChainConfigFromEnv(process.env);
    const chainsByChainId = new Map(chains.map((c) => [c.chainId, c]));

    const sources = await this.daoSourceRepo.findBySourceType('compound_governor');

    if (sources.length === 0) {
      this.logger.warn('No compound_governor dao_source rows; indexer will idle');
      getIndexerActiveSources().set({ source_type: 'compound_governor' }, 0);
      return;
    }

    // Pre-validate ALL source_configs + chain mappings before starting any client (D-F1c-13)
    const validated: Array<{
      src: (typeof sources)[number];
      cfg: DaoSourceConfig;
      chainCfg: ChainConfig;
    }> = [];

    for (const src of sources) {
      const parsed = DaoSourceConfigSchema.safeParse(src.source_config);
      if (!parsed.success) {
        throw new Error(
          `compound_governor dao_source ${src.id} has malformed source_config: ${parsed.error.message}`,
        );
      }
      const chainCfg = chainsByChainId.get(src.primary_chain_id);
      if (!chainCfg) {
        throw new Error(
          `compound_governor dao_source ${src.id} on chain ${src.primary_chain_id} but CHAIN_CONFIG has no entry`,
        );
      }
      validated.push({ src, cfg: parsed.data, chainCfg });
    }

    // Create per-chain RPC clients; wrap in try/catch for cleanup on partial failure (D-F1c-14)
    const clientsByChainId = new Map<number, FailoverRpcClient>();
    try {
      for (const { src, chainCfg } of validated) {
        if (clientsByChainId.has(src.primary_chain_id)) continue;
        const client = new FailoverRpcClient(chainCfg);
        await client.start();
        clientsByChainId.set(src.primary_chain_id, client);
        this.clients.push(client);
      }

      for (const { src, cfg, chainCfg } of validated) {
        const client = clientsByChainId.get(src.primary_chain_id)!;

        const poller = new EventPoller({
          rpcClient: client,
          chainId: src.primary_chain_id,
          chainName: chainCfg.name,
          reorgHorizon: chainCfg.reorgHorizon,
          sourceType: 'compound_governor',
          daoSourceLabel: src.id,
          filter: {
            address: cfg.governor_address.toLowerCase(),
            topics: [Object.values(COMPOUND_EVENT_TOPICS)],
          },
          pollIntervalMs: 12_000,
          logger: toChainLogger(this.logger),
        });

        const listener = makeIngesterListener({
          archiveWriter: this.archiveWriter,
          context: {
            daoSourceId: src.id,
            sourceType: 'compound_governor',
            chainId: src.primary_chain_id,
            sourceLabel: 'compound_governor',
          },
          logger: toChainLogger(this.logger),
          dlqRepo: this.dlqRepo,
        });

        poller.onEvents(listener);
        await poller.start();
        this.pollers.push(poller);
      }
    } catch (err) {
      this.logger.error('bootstrap_failed_cleanup', { error: String(err) });
      await Promise.allSettled(this.pollers.map((p) => p.stop()));
      await Promise.allSettled(this.clients.map((c) => c.stop()));
      this.pollers.length = 0;
      this.clients.length = 0;
      throw err;
    }

    getIndexerActiveSources().set({ source_type: 'compound_governor' }, sources.length);
    this.logger.log(
      `compound_governor: ${sources.length} source(s) live across ${clientsByChainId.size} chain(s)`,
    );

    this.startPendingDepthGauge();
  }

  async drain(): Promise<void> {
    if (this.gaugeInterval !== null) {
      clearInterval(this.gaugeInterval);
      this.gaugeInterval = null;
    }
    await Promise.allSettled(this.pollers.map((p) => p.stop()));
    await Promise.allSettled(this.clients.map((c) => c.stop()));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  private startPendingDepthGauge(): void {
    const updateGauge = async () => {
      try {
        const rows = await this.confirmationRepo.countPendingBySourceType('compound_governor');
        for (const row of rows) {
          getPendingEventCount().set(
            { chain_id: String(row.chain_id), source_type: row.source_type },
            Number(row.count),
          );
        }
      } catch (err) {
        this.logger.warn('pending_depth_gauge_error', { error: String(err) });
      }
    };

    this.gaugeInterval = setInterval(() => {
      void updateGauge();
    }, 10_000);
  }
}
