import { Logger, Module } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';
import {
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
  AaveGovernorV2ActorAddressDeriver,
  AaveGovernorV2ArchivePayloadRepository,
  AaveGovernorV2ArchiveWriter,
  AaveGovernorV2EventRepository,
  AaveGovernorV2ProjectionApplier,
  AaveGovernorV2VoteProjectionApplier,
  AaveIpfsTitleFetcher,
  AavePayloadStitchApplier,
  AavePayloadReconcileRepository,
  AavePayloadsControllerActorAddressDeriver,
  AavePayloadsControllerArchivePayloadRepository,
  AavePayloadsControllerArchiveWriter,
  AavePayloadsControllerEventRepository,
  AaveProposalRepository,
  AaveTokenActorAddressDeriver,
  AaveTokenArchivePayloadRepository,
  AaveTokenArchiveWriter,
  AaveTokenDelegationProjectionApplier,
  AaveTokenEventRepository,
  AaveVoteProjectionApplier,
  AaveVotingMachineActorAddressDeriver,
  AaveVotingMachineArchiveWriter,
  AaveVotingMachineArchivePayloadRepository,
  AaveVotingMachineEventRepository,
  createAaveGovernorV2Plugin,
  createAaveTokenPlugin,
  createAaveGovernorV2ReconcilePlugin,
  createAavePayloadsControllerPlugin,
  createAavePayloadsControllerReconcilePlugin,
  createAaveGovernanceV3ReconcilePlugin,
  createAaveGovernanceV3Plugin,
  createAaveVotingMachinePlugin,
  makeAaveApiContribution,
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
      provide: AaveGovernorV2ArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) =>
        new AaveGovernorV2ArchiveWriter({
          eventRepo: new AaveGovernorV2EventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('AaveGovernorV2ArchiveWriter')),
        }),
      inject: [ArchiveEventRepository, DlqRepository],
    },
    {
      provide: AaveGovernorV2ArchivePayloadRepository,
      useFactory: () => new AaveGovernorV2ArchivePayloadRepository(chDb),
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
            processed: ({ source_type, event_type, outcome, reason }) =>
              aaveMetrics.voteDerivation.add(1, {
                source_type,
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
      provide: AaveGovernorV2ProjectionApplier,
      useFactory: (
        archive: ArchiveDerivationRepository,
        dlqRepo: DlqRepository,
        payloads: AaveGovernorV2ArchivePayloadRepository,
        ipfsFetcher: AaveIpfsTitleFetcher,
      ) =>
        new AaveGovernorV2ProjectionApplier({
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
          logger: toChainLogger(new Logger('AaveGovernorV2ProjectionApplier')),
        }),
      inject: [
        ArchiveDerivationRepository,
        DlqRepository,
        AaveGovernorV2ArchivePayloadRepository,
        AaveIpfsTitleFetcher,
      ],
    },
    {
      provide: AaveGovernorV2ActorAddressDeriver,
      useFactory: (payloads: AaveGovernorV2ArchivePayloadRepository) =>
        new AaveGovernorV2ActorAddressDeriver(payloads),
      inject: [AaveGovernorV2ArchivePayloadRepository],
    },
    {
      provide: AaveGovernorV2VoteProjectionApplier,
      useFactory: (
        archive: ArchiveDerivationRepository,
        dlqRepo: DlqRepository,
        payloads: AaveGovernorV2ArchivePayloadRepository,
        proposals: ProposalRepository,
        voteRead: VoteEventsProjectionReadRepository,
        voteWrite: VoteEventsProjectionWriter,
        registry: ChainContextRegistry,
      ) =>
        new AaveGovernorV2VoteProjectionApplier({
          archive,
          dlq: dlqRepo,
          payloads,
          proposals,
          voteRead,
          voteWrite,
          registry,
          metrics: {
            batchLookupSeconds: () => undefined,
            chWriteSeconds: () => undefined,
            processed: ({ event_type, outcome, reason }) =>
              aaveMetrics.voteDerivation.add(1, {
                source_type: 'aave_governor_v2',
                event_type,
                outcome,
                reason: reason ?? 'none',
              }),
          },
          logger: toChainLogger(new Logger('AaveGovernorV2VoteProjectionApplier')),
        }),
      inject: [
        ArchiveDerivationRepository,
        DlqRepository,
        AaveGovernorV2ArchivePayloadRepository,
        ProposalRepository,
        VoteEventsProjectionReadRepository,
        VoteEventsProjectionWriter,
        ChainContextRegistry,
      ],
    },
    {
      provide: AaveTokenArchiveWriter,
      useFactory: (archiveEventRepo: ArchiveEventRepository, dlqRepo: DlqRepository) =>
        new AaveTokenArchiveWriter({
          eventRepo: new AaveTokenEventRepository({ chDb }),
          archiveEventRepo,
          dlqRepo,
          logger: toChainLogger(new Logger('AaveTokenArchiveWriter')),
        }),
      inject: [ArchiveEventRepository, DlqRepository],
    },
    {
      provide: AaveTokenArchivePayloadRepository,
      useFactory: () => new AaveTokenArchivePayloadRepository(chDb),
    },
    {
      provide: AaveTokenActorAddressDeriver,
      useFactory: (payloads: AaveTokenArchivePayloadRepository) =>
        new AaveTokenActorAddressDeriver(payloads),
      inject: [AaveTokenArchivePayloadRepository],
    },
    {
      provide: AaveTokenDelegationProjectionApplier,
      useFactory: (
        archive: ArchiveDerivationRepository,
        dlqRepo: DlqRepository,
        payloads: AaveTokenArchivePayloadRepository,
      ) =>
        new AaveTokenDelegationProjectionApplier({
          pgDb,
          chDb,
          archive,
          dlq: dlqRepo,
          payloads,
          metrics: {
            batchLookupSeconds: () => undefined,
            chWriteSeconds: () => undefined,
            processed: ({ source_type, event_type, outcome, reason }) =>
              aaveMetrics.delegationDerivation.add(1, {
                source_type,
                event_type,
                outcome,
                reason: reason ?? 'none',
              }),
          },
          logger: toChainLogger(new Logger('AaveTokenDelegationProjectionApplier')),
        }),
      inject: [ArchiveDerivationRepository, DlqRepository, AaveTokenArchivePayloadRepository],
    },
    {
      provide: AAVE_SOURCE_PLUGIN,
      useFactory: (
        archiveWriter: AaveGovernanceArchiveWriter,
        governorV2ArchiveWriter: AaveGovernorV2ArchiveWriter,
        votingMachineArchiveWriter: AaveVotingMachineArchiveWriter,
        payloadsControllerArchiveWriter: AavePayloadsControllerArchiveWriter,
        dlqRepo: DlqRepository,
        proposals: AaveProposalRepository,
        payloadReconcileProposals: AavePayloadReconcileRepository,
        projectionApplier: AaveGovernanceProjectionApplier,
        actorAddressDeriver: AaveGovernanceActorAddressDeriver,
        governorV2ProjectionApplier: AaveGovernorV2ProjectionApplier,
        governorV2VoteProjectionApplier: AaveGovernorV2VoteProjectionApplier,
        governorV2ActorAddressDeriver: AaveGovernorV2ActorAddressDeriver,
        votingMachineActorAddressDeriver: AaveVotingMachineActorAddressDeriver,
        voteProjectionApplier: AaveVoteProjectionApplier,
        payloadsControllerActorAddressDeriver: AavePayloadsControllerActorAddressDeriver,
        payloadStitchApplier: AavePayloadStitchApplier,
        aaveTokenArchiveWriter: AaveTokenArchiveWriter,
        aaveTokenDelegationProjectionApplier: AaveTokenDelegationProjectionApplier,
        aaveTokenActorAddressDeriver: AaveTokenActorAddressDeriver,
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
            createAaveGovernorV2Plugin({
              archiveWriter: governorV2ArchiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('AaveGovernorV2')),
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
            // Y1 registers admin-cli backfill and DLQ-retry providers for this source.
            createAaveTokenPlugin({
              archiveWriter: aaveTokenArchiveWriter,
              dlqRepo,
              logger: toChainLogger(new Logger('AaveToken')),
            }),
            createAaveGovernanceV3ReconcilePlugin({
              proposals,
              metrics,
              logger: toChainLogger(new Logger('AaveGovernanceReconcile')),
            }),
            createAaveGovernorV2ReconcilePlugin({
              proposals,
              metrics,
              logger: toChainLogger(new Logger('AaveGovernorV2Reconcile')),
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
            governorV2ProjectionApplier,
            governorV2VoteProjectionApplier,
            governorV2ActorAddressDeriver,
            votingMachineActorAddressDeriver,
            voteProjectionApplier,
            payloadsControllerActorAddressDeriver,
            payloadStitchApplier,
            aaveTokenDelegationProjectionApplier,
            aaveTokenActorAddressDeriver,
          ],
          apiContribution: makeAaveApiContribution(pgDb),
        };
      },
      inject: [
        AaveGovernanceArchiveWriter,
        AaveGovernorV2ArchiveWriter,
        AaveVotingMachineArchiveWriter,
        AavePayloadsControllerArchiveWriter,
        DlqRepository,
        AaveProposalRepository,
        AavePayloadReconcileRepository,
        AaveGovernanceProjectionApplier,
        AaveGovernanceActorAddressDeriver,
        AaveGovernorV2ProjectionApplier,
        AaveGovernorV2VoteProjectionApplier,
        AaveGovernorV2ActorAddressDeriver,
        AaveVotingMachineActorAddressDeriver,
        AaveVoteProjectionApplier,
        AavePayloadsControllerActorAddressDeriver,
        AavePayloadStitchApplier,
        AaveTokenArchiveWriter,
        AaveTokenDelegationProjectionApplier,
        AaveTokenActorAddressDeriver,
      ],
    },
  ],
  exports: [AAVE_SOURCE_PLUGIN],
})
export class AaveSourceModule {}
