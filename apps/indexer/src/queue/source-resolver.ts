import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { DaoSourceRepository } from '@libs/db';
import type { SourceType } from '@libs/db';
import { SOURCE_INGESTERS } from '@sources/core';
import type { SourceIngester, SourceContext } from '@sources/core';

export interface ResolvedSource {
  sourceType: string;
  daoSourceId: string;
  sourceLabel: string;
  chainId: string;
}

@Injectable()
export class SourceResolver implements OnApplicationBootstrap {
  private readonly logger = new Logger('SourceResolver');
  private map = new Map<string, ResolvedSource>();

  constructor(
    @Inject(SOURCE_INGESTERS) private readonly ingesters: ReadonlyArray<SourceIngester>,
    private readonly daoSourceRepo: DaoSourceRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.rebuild();
  }

  resolve(chainId: string, address: string): ResolvedSource | undefined {
    return this.map.get(`${chainId}:${address.toLowerCase()}`);
  }

  async rebuild(): Promise<void> {
    const sources = await this.daoSourceRepo.findAll();
    const ingestersByType = new Map(this.ingesters.map((i) => [i.sourceType, i]));
    const newMap = new Map<string, ResolvedSource>();

    for (const src of sources) {
      const ingester = ingestersByType.get(src.source_type);
      if (!ingester) continue;
      if (!ingester.supportedChainIds.includes(src.chain_id)) continue;

      let cfg: unknown;
      try {
        cfg = ingester.parseConfig(src.source_config);
      } catch {
        continue;
      }

      const ctx: SourceContext = {
        daoSourceId: src.id,
        sourceType: src.source_type as SourceType,
        chainId: src.chain_id,
        sourceLabel: src.source_type as SourceType,
      };

      const spec = ingester.buildIngestSpec(ctx, cfg);
      if (spec.kind !== 'evm-event-poller') continue;

      const addresses = Array.isArray(spec.filter.address)
        ? spec.filter.address
        : [spec.filter.address];

      const resolved: ResolvedSource = {
        sourceType: src.source_type,
        daoSourceId: src.id,
        sourceLabel: src.source_type,
        chainId: src.chain_id,
      };

      for (const addr of addresses) {
        newMap.set(`${src.chain_id}:${addr.toLowerCase()}`, resolved);
      }
    }

    this.map = newMap;
    this.logger.log('source_resolver_rebuilt', { entries: newMap.size });
  }
}
