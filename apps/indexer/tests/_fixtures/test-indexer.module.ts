import { Module } from '@nestjs/common';
import {
  SOURCE_INGESTERS,
  SOURCE_PLUGINS,
  type SourceIngester,
  type SourcePlugin,
} from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { TestEvmSourceModule } from './test-source.module';
import { IndexerInfraModule } from '../../src/infra/indexer-infra.module';
import { EvmEventPollerDriver } from '../../src/orchestrator/evm-event-poller-driver';
import type { FetchDriver } from '../../src/orchestrator/fetch-driver';
import { IndexerOrchestratorService } from '../../src/orchestrator/indexer-orchestrator.service';
import { FETCH_DRIVERS } from '../../src/orchestrator/tokens';
import { ArchiveProducerProvider } from '../../src/queue/archive-producer.provider';

@Module({
  imports: [IndexerInfraModule, ChainContextModule, TestEvmSourceModule],
  providers: [
    {
      provide: SOURCE_INGESTERS,
      useFactory: (plugins: SourcePlugin[]): SourceIngester[] =>
        plugins.flatMap((p) => p.ingesters),
      inject: [SOURCE_PLUGINS],
    },
    ArchiveProducerProvider,
    EvmEventPollerDriver,
    {
      provide: FETCH_DRIVERS,
      useFactory: (eventPoller: EvmEventPollerDriver): FetchDriver[] => [eventPoller],
      inject: [EvmEventPollerDriver],
    },
    IndexerOrchestratorService,
  ],
})
export class TestIndexerModule {}
