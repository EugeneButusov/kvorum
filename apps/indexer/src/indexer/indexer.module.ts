import { Module } from '@nestjs/common';
import type { SourceIngester, SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { SourcesModule } from '@nest/sources';
import { SOURCE_PLUGINS as SOURCE_PLUGIN_BUNDLES } from '@sources/core';
import { DerivationModule } from '../derivation';
import { IndexerInfraModule } from '../infra/indexer-infra.module';
import { EvmBlockHeadPollerDriver } from '../orchestrator/evm-block-head-poller-driver';
import { EvmEventPollerDriver } from '../orchestrator/evm-event-poller-driver';
import type { FetchDriver } from '../orchestrator/fetch-driver';
import { IndexerOrchestratorService } from '../orchestrator/indexer-orchestrator.service';
import { PromotionSweepService } from '../orchestrator/promotion-sweep.service';
import { ReorgWatcherService } from '../orchestrator/reorg-watcher.service';
import { SOURCE_INGESTERS, FETCH_DRIVERS } from '../orchestrator/tokens';

@Module({
  imports: [IndexerInfraModule, ChainContextModule, DerivationModule, SourcesModule],
  providers: [
    {
      provide: SOURCE_INGESTERS,
      useFactory: (plugins: SourcePlugin[]): SourceIngester[] =>
        plugins.flatMap((p) => p.ingesters),
      inject: [SOURCE_PLUGIN_BUNDLES],
    },
    EvmEventPollerDriver,
    EvmBlockHeadPollerDriver,
    {
      provide: FETCH_DRIVERS,
      useFactory: (ep: EvmEventPollerDriver, bhp: EvmBlockHeadPollerDriver): FetchDriver[] => [
        ep,
        bhp,
      ],
      inject: [EvmEventPollerDriver, EvmBlockHeadPollerDriver],
    },
    IndexerOrchestratorService,
    ReorgWatcherService,
    PromotionSweepService,
  ],
})
export class IndexerModule {}
