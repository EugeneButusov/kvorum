import { Module } from '@nestjs/common';
import { ChainContextModule } from '@nest/chain';
import { DerivationModule } from '../../src/derivation';
import { IndexerInfraModule } from '../../src/infra/indexer-infra.module';
import { EvmEventPollerDriver } from '../../src/orchestrator/evm-event-poller-driver';
import type { FetchDriver } from '../../src/orchestrator/fetch-driver';
import { FETCH_DRIVERS } from '../../src/orchestrator/tokens';

// IndexerOrchestratorService is NOT provided here: it depends on SOURCE_PLUGINS,
// which must come from a source module unknown to this generic fixture.
// Consuming test modules that import both TestEvmIndexerModule and a source module
// should provide IndexerOrchestratorService themselves — they can see all exports.
@Module({
  imports: [IndexerInfraModule, ChainContextModule, DerivationModule],
  providers: [
    EvmEventPollerDriver,
    {
      provide: FETCH_DRIVERS,
      useFactory: (eventPoller: EvmEventPollerDriver): FetchDriver[] => [eventPoller],
      inject: [EvmEventPollerDriver],
    },
  ],
  exports: [IndexerInfraModule, ChainContextModule, EvmEventPollerDriver, FETCH_DRIVERS],
})
export class TestEvmIndexerModule {}
