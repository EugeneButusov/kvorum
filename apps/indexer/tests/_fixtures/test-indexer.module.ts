import { Module } from '@nestjs/common';
import { ChainContextModule } from '@nest/chain';
import { TestEvmSourceModule } from './test-source.module';
import { IndexerInfraModule } from '../../src/infra/indexer-infra.module';
import { EvmEventPollerDriver } from '../../src/orchestrator/evm-event-poller-driver';
import type { FetchDriver } from '../../src/orchestrator/fetch-driver';
import { IndexerOrchestratorService } from '../../src/orchestrator/indexer-orchestrator.service';
import { PromotionSweepService } from '../../src/orchestrator/promotion-sweep.service';
import { ReorgWatcherService } from '../../src/orchestrator/reorg-watcher.service';
import { FETCH_DRIVERS } from '../../src/orchestrator/tokens';

@Module({
  imports: [IndexerInfraModule, ChainContextModule, TestEvmSourceModule],
  providers: [
    EvmEventPollerDriver,
    {
      provide: FETCH_DRIVERS,
      useFactory: (eventPoller: EvmEventPollerDriver): FetchDriver[] => [eventPoller],
      inject: [EvmEventPollerDriver],
    },
    IndexerOrchestratorService,
    ReorgWatcherService,
    PromotionSweepService,
  ],
})
export class TestIndexerModule {}
