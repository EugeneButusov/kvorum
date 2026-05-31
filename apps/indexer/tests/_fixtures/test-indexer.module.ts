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
import { JOB_QUEUE_PORT } from '../../src/queue/job-queue-port';
import { JobQueueService } from '../../src/queue/job-queue.service';

@Module({
  imports: [IndexerInfraModule, ChainContextModule, TestEvmSourceModule],
  providers: [
    {
      provide: SOURCE_INGESTERS,
      /* v8 ignore next -- integration-only: useFactory runs only inside a live Nest container */
      useFactory: (plugins: SourcePlugin[]): SourceIngester[] =>
        plugins.flatMap((p) => p.ingesters),
      inject: [SOURCE_PLUGINS],
    },
    JobQueueService,
    { provide: JOB_QUEUE_PORT, useExisting: JobQueueService },
    EvmEventPollerDriver,
    {
      provide: FETCH_DRIVERS,
      /* v8 ignore next -- integration-only: useFactory runs only inside a live Nest container */
      useFactory: (eventPoller: EvmEventPollerDriver): FetchDriver[] => [eventPoller],
      inject: [EvmEventPollerDriver],
    },
    IndexerOrchestratorService,
  ],
})
export class TestIndexerModule {}
