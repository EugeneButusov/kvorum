import { Module } from '@nestjs/common';
import { SOURCE_INGESTERS, SOURCE_PLUGINS } from '@sources/core';
import type { SourceIngester, SourcePlugin } from '@sources/core';
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
import { ArchiveProducerProvider } from '../queue/archive-producer.provider';
import { PgBossLifecycle } from '../queue/pg-boss-lifecycle';
import { SeenLogPruneService } from '../queue/seen-log-prune.service';
import { SnapshotModule } from '../snapshot';

@Module({
  imports: [
    IndexerInfraModule,
    ChainContextModule,
    DerivationModule,
    SnapshotModule,
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
    PgBossLifecycle,
    ArchiveProducerProvider,
    SeenLogPruneService,
    IndexerOrchestratorService,
  ],
})
export class IndexerModule {}
