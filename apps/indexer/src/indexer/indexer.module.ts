import { Module } from '@nestjs/common';
import type { SourcePlugin } from '@sources/core';
import { CompoundSourceModule, COMPOUND_PLUGIN } from '@nest/compound';
import { IndexerInfraModule } from '../infra/indexer-infra.module';
import { ChainContextRegistry } from '../orchestrator/chain-context-registry';
import { EvmEventPollerDriver } from '../orchestrator/evm-event-poller-driver';
import { IndexerOrchestratorService } from '../orchestrator/indexer-orchestrator.service';
import { PromotionSweepService } from '../orchestrator/promotion-sweep.service';
import { ReorgWatcherService } from '../orchestrator/reorg-watcher.service';
import { SOURCE_PLUGINS, FETCH_DRIVERS } from '../orchestrator/tokens';

@Module({
  imports: [IndexerInfraModule, CompoundSourceModule],
  providers: [
    ChainContextRegistry,
    {
      provide: SOURCE_PLUGINS,
      useFactory: (compound: SourcePlugin) => [compound],
      inject: [COMPOUND_PLUGIN],
    },
    {
      provide: FETCH_DRIVERS,
      useFactory: (registry: ChainContextRegistry) => [new EvmEventPollerDriver(registry)],
      inject: [ChainContextRegistry],
    },
    IndexerOrchestratorService,
    ReorgWatcherService,
    PromotionSweepService,
  ],
})
export class IndexerModule {}
