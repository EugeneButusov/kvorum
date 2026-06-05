import { Logger, Module } from '@nestjs/common';
import {
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DlqRepository,
  chDb,
  pgDb,
} from '@libs/db';
import {
  AaveGovernanceActorAddressDeriver,
  AaveGovernanceArchiveWriter,
  AaveGovernanceArchivePayloadRepository,
  AaveGovernanceEventRepository,
  AaveGovernanceProjectionApplier,
  AaveIpfsTitleFetcher,
  AaveProposalRepository,
  AaveVotingMachineArchiveWriter,
  AaveVotingMachineEventRepository,
  createAaveGovernanceV3ReconcilePlugin,
  createAaveGovernanceV3Plugin,
  createAaveVotingMachinePlugin,
} from '@sources/aave';
import type { SourcePlugin } from '@sources/core';
import { ChainContextModule } from '@nest/chain';
import { toChainLogger } from '@nest/chain';
import { DbModule } from '@nest/db';
import { aaveMetrics } from './aave-metrics';
import { buildDriverMetrics } from '../../reconcile-metrics';

export const AAVE_SOURCE_PLUGIN = 'AAVE_SOURCE_PLUGIN';

@Module({
  imports: [
    ChainContextModule,
    DbModule.forFeature([ArchiveDerivationRepository, ArchiveEventRepository, DlqRepository]),
  ],
  providers: [
    {
      provide: AaveGovernanceArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) =>
        new AaveGovernanceArchiveWriter({
          eventRepo: new AaveGovernanceEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('AaveGovernanceArchiveWriter')),
        }),
      inject: [ArchiveEventRepository, DlqRepository],
    },
    {
      provide: AaveVotingMachineArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) =>
        new AaveVotingMachineArchiveWriter({
          eventRepo: new AaveVotingMachineEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('AaveVotingMachineArchiveWriter')),
        }),
      inject: [ArchiveEventRepository, DlqRepository],
    },
    {
      provide: AaveGovernanceArchivePayloadRepository,
      useFactory: () => new AaveGovernanceArchivePayloadRepository(chDb),
    },
    {
      provide: AaveProposalRepository,
      useFactory: () => new AaveProposalRepository(pgDb),
    },
    {
      provide: AaveIpfsTitleFetcher,
      useFactory: () =>
        new AaveIpfsTitleFetcher({
          gatewayUrl: process.env['IPFS_GATEWAY_URL'],
          fallbackGatewayUrl: process.env['IPFS_GATEWAY_FALLBACK_URL'],
          timeoutMs:
            process.env['IPFS_FETCH_TIMEOUT_MS'] == null
              ? undefined
              : Number(process.env['IPFS_FETCH_TIMEOUT_MS']),
        }),
    },
    {
      provide: AaveGovernanceProjectionApplier,
      useFactory: (
        archive: ArchiveDerivationRepository,
        dlqRepo: DlqRepository,
        payloads: AaveGovernanceArchivePayloadRepository,
        ipfsFetcher: AaveIpfsTitleFetcher,
      ) =>
        new AaveGovernanceProjectionApplier({
          pgDb,
          archive,
          dlq: dlqRepo,
          payloads,
          ipfsFetcher,
          metrics: {
            batchLookupSeconds: () => undefined,
            processed: () => undefined,
            ipfsTitleFetch: (outcome) => aaveMetrics.ipfsTitleFetch.add(1, { outcome }),
          },
          logger: toChainLogger(new Logger('AaveGovernanceProjectionApplier')),
        }),
      inject: [
        ArchiveDerivationRepository,
        DlqRepository,
        AaveGovernanceArchivePayloadRepository,
        AaveIpfsTitleFetcher,
      ],
    },
    {
      provide: AaveGovernanceActorAddressDeriver,
      useFactory: (payloads: AaveGovernanceArchivePayloadRepository) =>
        new AaveGovernanceActorAddressDeriver(payloads),
      inject: [AaveGovernanceArchivePayloadRepository],
    },
    {
      provide: AAVE_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: AaveGovernanceArchiveWriter,
        votingMachineArchiveWriter: AaveVotingMachineArchiveWriter,
        dlqRepo: DlqRepository,
        proposals: AaveProposalRepository,
        projectionApplier: AaveGovernanceProjectionApplier,
        actorAddressDeriver: AaveGovernanceActorAddressDeriver,
      ): SourcePlugin => {
        const metrics = buildDriverMetrics();
        return {
          name: 'aave',
          ingesters: [
            createAaveGovernanceV3Plugin({
              archiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('AaveGovernanceV3')),
            }),
            createAaveVotingMachinePlugin({
              archiveWriter: votingMachineArchiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('AaveVotingMachine')),
            }),
            createAaveGovernanceV3ReconcilePlugin({
              proposals,
              metrics,
              logger: toChainLogger(new Logger('AaveGovernanceReconcile')),
            }),
          ],
          derivers: [projectionApplier, actorAddressDeriver],
          snapshotStrategies: [],
        };
      },
      inject: [
        AaveGovernanceArchiveWriter,
        AaveVotingMachineArchiveWriter,
        DlqRepository,
        AaveProposalRepository,
        AaveGovernanceProjectionApplier,
        AaveGovernanceActorAddressDeriver,
      ],
    },
  ],
  exports: [AAVE_SOURCE_PLUGIN],
})
export class AaveSourceModule {}
