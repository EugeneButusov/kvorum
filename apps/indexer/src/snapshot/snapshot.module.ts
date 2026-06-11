import { Logger, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  DlqRepository,
  ProposalRepository,
  VotingPowerSnapshotProjectionWriter,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
import {
  buildSnapshotStrategies,
  SnapshotTickRunner,
  SOURCE_PLUGINS,
  type SourcePlugin,
} from '@sources/core';
import { ChainContextModule, toChainLogger } from '@nest/chain';
import { DbModule } from '@nest/db';
import { SourcesModule } from '@nest/sources';
import { snapshotMetrics } from './snapshot-metrics';
import { SnapshotWorkerService } from './snapshot-worker.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ChainContextModule,
    SourcesModule,
    DbModule.forFeature([
      VotingPowerSnapshotProjectionWriter,
      ProposalRepository,
      VotingPowerSnapshotRunRepository,
      DlqRepository,
    ]),
  ],
  providers: [
    {
      provide: SnapshotWorkerService,
      useFactory: (
        proposals: ProposalRepository,
        snapshots: VotingPowerSnapshotProjectionWriter,
        runs: VotingPowerSnapshotRunRepository,
        dlq: DlqRepository,
        plugins: readonly SourcePlugin[],
      ) =>
        new SnapshotWorkerService(
          new SnapshotTickRunner({
            proposalRepo: proposals,
            snapshotRepo: snapshots,
            runRepo: runs,
            dlqRepo: dlq,
            strategies: buildSnapshotStrategies(plugins),
            logger: toChainLogger(new Logger('SnapshotTickRunner')),
            metrics: {
              populationSize: (size) => snapshotMetrics.populationSize.record(size),
              proposalsProcessed: (outcome) =>
                snapshotMetrics.proposalsProcessed.add(1, { outcome }),
            },
          }),
        ),
      inject: [
        ProposalRepository,
        VotingPowerSnapshotProjectionWriter,
        VotingPowerSnapshotRunRepository,
        DlqRepository,
        SOURCE_PLUGINS,
      ],
    },
  ],
  exports: [SnapshotWorkerService],
})
export class SnapshotModule {}
