import { Module } from '@nestjs/common';
import type { SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { COMPOUND_PLUGINS, CompoundSourceModule, CompoundReconcileService } from '@nest/compound';
import { DerivationModule } from '../derivation';
import { IndexerInfraModule } from '../infra/indexer-infra.module';
import { EvmEventPollerDriver } from '../orchestrator/evm-event-poller-driver';
import { IndexerOrchestratorService } from '../orchestrator/indexer-orchestrator.service';
import { PromotionSweepService } from '../orchestrator/promotion-sweep.service';
import { ReorgWatcherService } from '../orchestrator/reorg-watcher.service';
import {
  SOURCE_PLUGINS,
  FETCH_DRIVERS,
  CHAIN_HEAD_LISTENERS,
  type ChainHeadListener,
} from '../orchestrator/tokens';

@Module({
  imports: [IndexerInfraModule, ChainContextModule, DerivationModule, CompoundSourceModule],
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (compoundPlugins: SourcePlugin[]) => compoundPlugins,
      inject: [COMPOUND_PLUGINS],
    },
    {
      provide: CHAIN_HEAD_LISTENERS,
      useFactory: (compoundReconcile: CompoundReconcileService): ChainHeadListener[] => [
        compoundReconcile,
      ],
      inject: [CompoundReconcileService],
    },
    EvmEventPollerDriver,
    { provide: FETCH_DRIVERS, useExisting: EvmEventPollerDriver },
    IndexerOrchestratorService,
    ReorgWatcherService,
    PromotionSweepService,
  ],
})
export class IndexerModule {}
