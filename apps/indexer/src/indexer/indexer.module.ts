import { Module } from '@nestjs/common';
import type { SourcePlugin } from '@sources/core';
import { COMPOUND_PLUGINS, COMPOUND_RECONCILERS, CompoundSourceModule } from '@nest/compound';
import { pgDb, ProposalRepository } from '@libs/db';
import { DerivationModule } from '../derivation';
import { IndexerInfraModule } from '../infra/indexer-infra.module';
import { ChainContextModule } from '../orchestrator/chain-context.module';
import { EvmEventPollerDriver } from '../orchestrator/evm-event-poller-driver';
import { IndexerOrchestratorService } from '../orchestrator/indexer-orchestrator.service';
import { PromotionSweepService } from '../orchestrator/promotion-sweep.service';
import { ReorgWatcherService } from '../orchestrator/reorg-watcher.service';
import { StateReconcilerService } from '../orchestrator/state-reconciler.service';
import { SOURCE_PLUGINS, FETCH_DRIVERS, STATE_RECONCILERS } from '../orchestrator/tokens';

@Module({
  imports: [IndexerInfraModule, ChainContextModule, DerivationModule, CompoundSourceModule],
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (compoundPlugins: SourcePlugin[]) => compoundPlugins,
      inject: [COMPOUND_PLUGINS],
    },
    {
      provide: ProposalRepository,
      useFactory: () => new ProposalRepository(pgDb),
    },
    {
      provide: STATE_RECONCILERS,
      useFactory: (reconcilers: unknown[]) => reconcilers,
      inject: [COMPOUND_RECONCILERS],
    },
    EvmEventPollerDriver,
    { provide: FETCH_DRIVERS, useExisting: EvmEventPollerDriver },
    IndexerOrchestratorService,
    ReorgWatcherService,
    PromotionSweepService,
    StateReconcilerService,
  ],
})
export class IndexerModule {}
