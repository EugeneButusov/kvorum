import { Module } from '@nestjs/common';
import type { SourcePlugin } from '@sources/core';
import { CompoundSourceModule, COMPOUND_PLUGIN } from '@nest/compound';
import { DerivationModule } from '../derivation';
import { IndexerInfraModule } from '../infra/indexer-infra.module';
import { ChainContextModule } from '../orchestrator/chain-context.module';
import { EvmEventPollerDriver } from '../orchestrator/evm-event-poller-driver';
import { IndexerOrchestratorService } from '../orchestrator/indexer-orchestrator.service';
import { PromotionSweepService } from '../orchestrator/promotion-sweep.service';
import { ReorgWatcherService } from '../orchestrator/reorg-watcher.service';
import { SOURCE_PLUGINS, FETCH_DRIVERS } from '../orchestrator/tokens';

@Module({
  imports: [IndexerInfraModule, ChainContextModule, DerivationModule, CompoundSourceModule],
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (compound: SourcePlugin) => [compound],
      inject: [COMPOUND_PLUGIN],
    },
    EvmEventPollerDriver,
    { provide: FETCH_DRIVERS, useExisting: EvmEventPollerDriver },
    IndexerOrchestratorService,
    ReorgWatcherService,
    PromotionSweepService,
  ],
})
export class IndexerModule {}
