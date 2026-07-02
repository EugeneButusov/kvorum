import { Module } from '@nestjs/common';
import { SOURCE_INGESTERS, SOURCE_PLUGINS } from '@sources/core';
import type {
  ArchiveConsumeFn,
  OffChainArchiveWriteFn,
  SourceIngester,
  SourcePlugin,
} from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { SourcesModule } from '@nest/sources';
import { DerivationModule } from '../derivation';
import { EnsResolverModule } from '../ens';
import { ForumLinkerModule } from '../forum/forum-linker.module';
import { IndexerInfraModule } from '../infra/indexer-infra.module';
import { EvmBlockHeadPollerDriver } from '../orchestrator/evm-block-head-poller-driver';
import { EvmEventPollerDriver } from '../orchestrator/evm-event-poller-driver';
import type { FetchDriver } from '../orchestrator/fetch-driver';
import { IndexerOrchestratorService } from '../orchestrator/indexer-orchestrator.service';
import { OffChainQueueProducer } from '../orchestrator/off-chain-queue-producer';
import { PollFetchDriver } from '../orchestrator/poll-fetch-driver';
import { FETCH_DRIVERS, QUEUE_PRODUCER_PORT } from '../orchestrator/tokens';
import { ArchiveLogDlqBridge } from '../queue/archive-log-dlq.bridge';
import { ArchiveLogConsumer, ARCHIVE_CONSUMER_FNS } from '../queue/archive-log.consumer';
import { JobQueueService } from '../queue/job-queue.service';
import { OffChainArchiveDlqBridge } from '../queue/off-chain-archive-dlq.bridge';
import {
  OffChainArchiveConsumer,
  OFF_CHAIN_ARCHIVE_WRITERS,
} from '../queue/off-chain-archive.consumer';
import { PgBossMetricsService } from '../queue/pgboss-metrics.service';
import { QUEUE_WORKER_PORT } from '../queue/queue-worker-port';
import { SeenLogPruneService } from '../queue/seen-log-prune.service';
import { SourceResolver } from '../queue/source-resolver';

@Module({
  imports: [
    IndexerInfraModule,
    ChainContextModule,
    DerivationModule,
    EnsResolverModule,
    SourcesModule,
    ForumLinkerModule,
  ],
  providers: [
    {
      provide: SOURCE_INGESTERS,
      useFactory: (plugins: SourcePlugin[]): SourceIngester[] =>
        plugins.flatMap((p) => p.ingesters),
      inject: [SOURCE_PLUGINS],
    },
    EvmEventPollerDriver,
    EvmBlockHeadPollerDriver,
    PollFetchDriver,
    OffChainQueueProducer,
    { provide: QUEUE_PRODUCER_PORT, useExisting: OffChainQueueProducer },
    {
      provide: FETCH_DRIVERS,
      useFactory: (
        ep: EvmEventPollerDriver,
        bhp: EvmBlockHeadPollerDriver,
        pd: PollFetchDriver,
      ): FetchDriver[] => [ep, bhp, pd],
      inject: [EvmEventPollerDriver, EvmBlockHeadPollerDriver, PollFetchDriver],
    },
    JobQueueService,
    { provide: QUEUE_WORKER_PORT, useExisting: JobQueueService },
    SeenLogPruneService,
    SourceResolver,
    {
      provide: ARCHIVE_CONSUMER_FNS,
      useFactory: (ingesters: SourceIngester[]): Map<string, ArchiveConsumeFn> => {
        const map = new Map<string, ArchiveConsumeFn>();
        for (const ingester of ingesters) {
          if (ingester.buildArchiveConsumer) {
            map.set(ingester.sourceType, ingester.buildArchiveConsumer());
          }
        }
        return map;
      },
      inject: [SOURCE_INGESTERS],
    },
    {
      provide: OFF_CHAIN_ARCHIVE_WRITERS,
      useFactory: (ingesters: SourceIngester[]): Map<string, OffChainArchiveWriteFn> => {
        const map = new Map<string, OffChainArchiveWriteFn>();
        for (const ingester of ingesters) {
          if (ingester.buildOffChainArchiveWriter) {
            map.set(ingester.sourceType, ingester.buildOffChainArchiveWriter());
          }
        }
        return map;
      },
      inject: [SOURCE_INGESTERS],
    },
    ArchiveLogConsumer,
    ArchiveLogDlqBridge,
    OffChainArchiveConsumer,
    OffChainArchiveDlqBridge,
    PgBossMetricsService,
    IndexerOrchestratorService,
  ],
})
export class IndexerModule {}
