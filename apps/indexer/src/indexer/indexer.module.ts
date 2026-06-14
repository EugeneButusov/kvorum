import { Module } from '@nestjs/common';
import { SOURCE_INGESTERS, SOURCE_PLUGINS } from '@sources/core';
import type { ArchiveConsumeFn, SourceIngester, SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { SourcesModule } from '@nest/sources';
import { DerivationModule } from '../derivation';
import { EnsResolverModule } from '../ens';
import { IndexerInfraModule } from '../infra/indexer-infra.module';
import { EvmBlockHeadPollerDriver } from '../orchestrator/evm-block-head-poller-driver';
import { EvmEventPollerDriver } from '../orchestrator/evm-event-poller-driver';
import type { FetchDriver } from '../orchestrator/fetch-driver';
import { IndexerOrchestratorService } from '../orchestrator/indexer-orchestrator.service';
import { FETCH_DRIVERS } from '../orchestrator/tokens';
import { ArchiveLogDlqBridge } from '../queue/archive-log-dlq.bridge';
import { ArchiveLogConsumer, ARCHIVE_CONSUMER_FNS } from '../queue/archive-log.consumer';
import { JOB_QUEUE_PORT } from '../queue/job-queue-port';
import { JobQueueService } from '../queue/job-queue.service';
import { PgBossMetricsService } from '../queue/pgboss-metrics.service';
import { SeenLogPruneService } from '../queue/seen-log-prune.service';
import { SourceResolver } from '../queue/source-resolver';

@Module({
  imports: [
    IndexerInfraModule,
    ChainContextModule,
    DerivationModule,
    EnsResolverModule,
    SourcesModule,
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
    {
      provide: FETCH_DRIVERS,
      useFactory: (ep: EvmEventPollerDriver, bhp: EvmBlockHeadPollerDriver): FetchDriver[] => [
        ep,
        bhp,
      ],
      inject: [EvmEventPollerDriver, EvmBlockHeadPollerDriver],
    },
    JobQueueService,
    { provide: JOB_QUEUE_PORT, useExisting: JobQueueService },
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
    ArchiveLogConsumer,
    ArchiveLogDlqBridge,
    PgBossMetricsService,
    IndexerOrchestratorService,
  ],
})
export class IndexerModule {}
