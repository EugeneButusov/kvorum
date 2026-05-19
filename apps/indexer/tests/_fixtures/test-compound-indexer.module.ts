import { Module } from '@nestjs/common';
import { silentLogger } from '@libs/chain';
import { pgDb, chDb } from '@libs/db';
import { ConfirmationRepository, DlqRepository } from '@libs/db';
import { ArchiveWriter, EventRepository, createCompoundPlugins } from '@sources/compound';
import type { SourcePlugin } from '@sources/core';
import { SOURCE_PLUGINS } from '@sources/core';
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
    {
      provide: SOURCE_PLUGINS,
      useFactory: (): SourcePlugin[] => {
        const confirmationRepo = new ConfirmationRepository(pgDb);
        const dlqRepo = new DlqRepository(pgDb);
        const eventRepo = new EventRepository({ chDb });
        const archiveWriter = new ArchiveWriter({
          eventRepo,
          confirmationRepo,
          dlqRepo,
          logger: silentLogger,
        });
        return createCompoundPlugins({ archiveWriter, dlqRepo, logger: silentLogger }).map((p) => ({
          ...p,
          supportedChainIds: ['0x7a69'],
        }));
      },
    },
    EvmEventPollerDriver,
    { provide: FETCH_DRIVERS, useExisting: EvmEventPollerDriver },
    IndexerOrchestratorService,
    ReorgWatcherService,
    PromotionSweepService,
  ],
})
export class TestCompoundIndexerModule {}
