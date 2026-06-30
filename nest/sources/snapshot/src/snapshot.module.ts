import { Logger, Module } from '@nestjs/common';
import {
  ArchiveDerivationRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
  chDb,
  pgDb,
} from '@libs/db';
import type { SourcePlugin } from '@sources/core';
import {
  SnapshotActorAddressDeriver,
  SnapshotArchivePayloadRepository,
  SnapshotClient,
  SnapshotProposalProjectionApplier,
  SnapshotProposalRepository,
  SnapshotVoteChoiceRepository,
  SnapshotVoteProjectionApplier,
  createSnapshotPlugin,
  makeSnapshotReadExtension,
  type SnapshotStaleProvider,
} from '@sources/snapshot';
import { toChainLogger } from '@nest/chain';

export const SNAPSHOT_SOURCE_PLUGIN = 'SNAPSHOT_SOURCE_PLUGIN';

// Reconcile re-queries up to this many stale closed proposals per space per poll tick.
const RECONCILE_BATCH = Number(process.env['SNAPSHOT_RECONCILE_BATCH'] ?? '25');

// Off-chain source: one `snapshot` plugin covering all three seeded spaces (lido/aave/compound).
// Registers the proposal + vote projection appliers, the actor-address deriver, and the
// closed-proposal reconcile pass. Registering here starts live polling + derivation on boot
// (gated by INDEXER_LIVE_POLLER_ENABLED).
@Module({
  providers: [
    {
      provide: SNAPSHOT_SOURCE_PLUGIN,
      useFactory: (): SourcePlugin => {
        const intervalEnv = process.env['SNAPSHOT_POLL_INTERVAL_MS'];
        const client = new SnapshotClient({
          url: process.env['SNAPSHOT_GRAPHQL_URL'],
          apiKey: process.env['SNAPSHOT_API_KEY'],
        });
        const payloads = new SnapshotArchivePayloadRepository(chDb);

        const proposalApplier = new SnapshotProposalProjectionApplier({
          pgDb,
          payloads,
          archive: new ArchiveDerivationRepository(pgDb),
          logger: toChainLogger(new Logger('SnapshotProposalProjection')),
        });
        const actorAddressDeriver = new SnapshotActorAddressDeriver(payloads);

        const voteApplier = new SnapshotVoteProjectionApplier({
          payloads,
          proposals: new ProposalRepository(pgDb),
          snapshotProposals: new SnapshotProposalRepository(pgDb),
          voteRead: new VoteEventsProjectionReadRepository(chDb),
          voteWrite: new VoteEventsProjectionWriter(chDb),
          voteChoice: new SnapshotVoteChoiceRepository(chDb),
          archive: new ArchiveDerivationRepository(pgDb),
          logger: toChainLogger(new Logger('SnapshotVoteProjection')),
        });

        // Per-space reconcile stale-provider, backed by the proposal/metadata tables. The signal is
        // threaded to the HTTP re-query in the listener; the PG read is bounded + indexed.
        const staleProviderFactory =
          (space: string): SnapshotStaleProvider =>
          () =>
            new SnapshotProposalRepository(pgDb).findStaleClosedProposalIds(space, RECONCILE_BATCH);

        return {
          name: 'snapshot',
          ingesters: [
            createSnapshotPlugin({
              client,
              chDb,
              intervalMs: intervalEnv ? Number(intervalEnv) : undefined,
              staleProviderFactory,
            }),
          ],
          derivers: [proposalApplier, actorAddressDeriver, voteApplier],
          readExtension: makeSnapshotReadExtension(),
        };
      },
    },
  ],
  exports: [SNAPSHOT_SOURCE_PLUGIN],
})
export class SnapshotSourceModule {}
