import { Logger, Module } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DlqRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
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
  AavePayloadStitchApplier,
  AavePayloadReconcileRepository,
  AavePayloadsControllerActorAddressDeriver,
  AavePayloadsControllerArchivePayloadRepository,
  AavePayloadsControllerArchiveWriter,
  AavePayloadsControllerEventRepository,
  AaveProposalRepository,
  AaveVoteProjectionApplier,
  AaveVotingPowerStrategy,
  AaveVotingMachineActorAddressDeriver,
  AaveVotingMachineArchiveWriter,
  AaveVotingMachineArchivePayloadRepository,
  AaveVotingMachineEventRepository,
  createAavePayloadsControllerPlugin,
  createAavePayloadsControllerReconcilePlugin,
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
    DbModule.forFeature([
      ActorRepository,
      ArchiveDerivationRepository,
      ArchiveEventRepository,
      DlqRepository,
      ProposalRepository,
      VoteEventsProjectionReadRepository,
      VoteEventsProjectionWriter,
    ]),
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
      provide: AavePayloadsControllerArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) =>
        new AavePayloadsControllerArchiveWriter({
          eventRepo: new AavePayloadsControllerEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('AavePayloadsControllerArchiveWriter')),
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
      provide: AavePayloadReconcileRepository,
      useFactory: () => new AavePayloadReconcileRepository(pgDb),
    },
    {
      provide: AaveVotingMachineArchivePayloadRepository,
      useFactory: () => new AaveVotingMachineArchivePayloadRepository(chDb),
    },
    {
      provide: AavePayloadsControllerArchivePayloadRepository,
      useFactory: () => new AavePayloadsControllerArchivePayloadRepository(chDb),
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
      provide: AaveVotingMachineActorAddressDeriver,
      useFactory: (payloads: AaveVotingMachineArchivePayloadRepository) =>
        new AaveVotingMachineActorAddressDeriver(payloads),
      inject: [AaveVotingMachineArchivePayloadRepository],
    },
    {
      provide: AavePayloadsControllerActorAddressDeriver,
      useFactory: (payloads: AavePayloadsControllerArchivePayloadRepository) =>
        new AavePayloadsControllerActorAddressDeriver(payloads),
      inject: [AavePayloadsControllerArchivePayloadRepository],
    },
    {
      provide: AaveVoteProjectionApplier,
      useFactory: (
        archive: ArchiveDerivationRepository,
        dlqRepo: DlqRepository,
        payloads: AaveVotingMachineArchivePayloadRepository,
        proposals: ProposalRepository,
        aaveProposals: AaveProposalRepository,
        voteRead: VoteEventsProjectionReadRepository,
        voteWrite: VoteEventsProjectionWriter,
        registry: ChainContextRegistry,
      ) =>
        new AaveVoteProjectionApplier({
          archive,
          dlq: dlqRepo,
          payloads,
          proposals,
          aaveProposals,
          voteRead,
          voteWrite,
          registry,
          metrics: {
            batchLookupSeconds: () => undefined,
            chWriteSeconds: () => undefined,
            stitchPendingSeconds: (seconds, { voting_chain_id, event_type }) =>
              aaveMetrics.stitchPendingSeconds.record(seconds, {
                voting_chain_id,
                event_type,
                source_type: 'aave_voting_machine',
              }),
            processed: ({ event_type, outcome, reason }) =>
              aaveMetrics.voteDerivation.add(1, {
                event_type,
                outcome,
                reason: reason ?? 'none',
              }),
          },
          logger: toChainLogger(new Logger('AaveVoteProjectionApplier')),
        }),
      inject: [
        ArchiveDerivationRepository,
        DlqRepository,
        AaveVotingMachineArchivePayloadRepository,
        ProposalRepository,
        AaveProposalRepository,
        VoteEventsProjectionReadRepository,
        VoteEventsProjectionWriter,
        ChainContextRegistry,
      ],
    },
    {
      provide: AavePayloadStitchApplier,
      useFactory: (
        archive: ArchiveDerivationRepository,
        dlqRepo: DlqRepository,
        payloads: AavePayloadsControllerArchivePayloadRepository,
        proposals: ProposalRepository,
        aaveProposals: AaveProposalRepository,
        registry: ChainContextRegistry,
      ) =>
        new AavePayloadStitchApplier({
          pgDb,
          archive,
          dlq: dlqRepo,
          payloads,
          proposals,
          aaveProposals,
          registry,
          metrics: {
            batchLookupSeconds: () => undefined,
            stitchUnmatchedPayloads: (count, { target_chain_id, event_type }) =>
              aaveMetrics.stitchUnmatchedPayload.record(count, {
                target_chain_id,
                event_type,
                source_type: 'aave_payloads_controller',
              }),
            stitchPendingSeconds: (seconds, { target_chain_id, event_type }) =>
              aaveMetrics.payloadStitchPendingSeconds.record(seconds, {
                target_chain_id,
                event_type,
                source_type: 'aave_payloads_controller',
              }),
            processed: ({ event_type, outcome, reason }) =>
              aaveMetrics.payloadDerivation.add(1, {
                event_type,
                outcome,
                reason: reason ?? 'none',
              }),
          },
          logger: toChainLogger(new Logger('AavePayloadStitchApplier')),
        }),
      inject: [
        ArchiveDerivationRepository,
        DlqRepository,
        AavePayloadsControllerArchivePayloadRepository,
        ProposalRepository,
        AaveProposalRepository,
        ChainContextRegistry,
      ],
    },
    {
      provide: AAVE_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: AaveGovernanceArchiveWriter,
        votingMachineArchiveWriter: AaveVotingMachineArchiveWriter,
        payloadsControllerArchiveWriter: AavePayloadsControllerArchiveWriter,
        dlqRepo: DlqRepository,
        proposals: AaveProposalRepository,
        payloadReconcileProposals: AavePayloadReconcileRepository,
        projectionApplier: AaveGovernanceProjectionApplier,
        actorAddressDeriver: AaveGovernanceActorAddressDeriver,
        votingMachineActorAddressDeriver: AaveVotingMachineActorAddressDeriver,
        voteProjectionApplier: AaveVoteProjectionApplier,
        payloadsControllerActorAddressDeriver: AavePayloadsControllerActorAddressDeriver,
        payloadStitchApplier: AavePayloadStitchApplier,
        actorRepository: ActorRepository,
        voteReadRepository: VoteEventsProjectionReadRepository,
      ): SourcePlugin => {
        const metrics = buildDriverMetrics();
        const snapshotStrategy = new AaveVotingPowerStrategy(
          voteReadRepository,
          actorRepository,
          toChainLogger(new Logger('AaveVotingPowerStrategy')),
        );
        return {
          name: 'aave',
          ingesters: [
            createAaveGovernanceV3Plugin({
              archiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('AaveGovernanceV3')),
            }),
            // Y1 registers admin-cli backfill and DLQ-retry providers for this source.
            createAaveVotingMachinePlugin({
              archiveWriter: votingMachineArchiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('AaveVotingMachine')),
            }),
            createAavePayloadsControllerPlugin({
              archiveWriter: payloadsControllerArchiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('AavePayloadsController')),
            }),
            createAaveGovernanceV3ReconcilePlugin({
              proposals,
              metrics,
              logger: toChainLogger(new Logger('AaveGovernanceReconcile')),
            }),
            createAavePayloadsControllerReconcilePlugin({
              proposals: payloadReconcileProposals,
              metrics,
              logger: toChainLogger(new Logger('AavePayloadsControllerReconcile')),
            }),
          ],
          derivers: [
            projectionApplier,
            actorAddressDeriver,
            votingMachineActorAddressDeriver,
            voteProjectionApplier,
            payloadsControllerActorAddressDeriver,
            payloadStitchApplier,
          ],
          snapshotStrategies: [
            {
              sourceTypes: ['aave_governance_v3'],
              strategy: snapshotStrategy,
              getBlockedProposalIds: () => proposals.findProposalIdsWithoutL1SnapshotBlock(),
            },
          ],
        };
      },
      inject: [
        AaveGovernanceArchiveWriter,
        AaveVotingMachineArchiveWriter,
        AavePayloadsControllerArchiveWriter,
        DlqRepository,
        AaveProposalRepository,
        AavePayloadReconcileRepository,
        AaveGovernanceProjectionApplier,
        AaveGovernanceActorAddressDeriver,
        AaveVotingMachineActorAddressDeriver,
        AaveVoteProjectionApplier,
        AavePayloadsControllerActorAddressDeriver,
        AavePayloadStitchApplier,
        ActorRepository,
        VoteEventsProjectionReadRepository,
      ],
    },
  ],
  exports: [AAVE_SOURCE_PLUGIN],
})
export class AaveSourceModule {}
