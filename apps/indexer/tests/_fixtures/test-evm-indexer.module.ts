import { Module } from '@nestjs/common';
import { ChainContextModule } from '@nest/chain';
import { DerivationModule } from '../../src/derivation';
import { IndexerInfraModule } from '../../src/infra/indexer-infra.module';
import { EvmEventPollerDriver } from '../../src/orchestrator/evm-event-poller-driver';
import { IndexerOrchestratorService } from '../../src/orchestrator/indexer-orchestrator.service';
import { PromotionSweepService } from '../../src/orchestrator/promotion-sweep.service';
import { ReorgWatcherService } from '../../src/orchestrator/reorg-watcher.service';
import { FETCH_DRIVERS } from '../../src/orchestrator/tokens';

@Module({
  imports: [IndexerInfraModule, ChainContextModule, DerivationModule],
  providers: [
    EvmEventPollerDriver,
    { provide: FETCH_DRIVERS, useExisting: EvmEventPollerDriver },
    IndexerOrchestratorService,
    ReorgWatcherService,
    PromotionSweepService,
  ],
})
export class TestEvmIndexerModule {}
