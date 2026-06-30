import { Logger, Module } from '@nestjs/common';
import { ArchiveDerivationRepository, chDb, pgDb } from '@libs/db';
import type { SourcePlugin } from '@sources/core';
import {
  SnapshotActorAddressDeriver,
  SnapshotArchivePayloadRepository,
  SnapshotClient,
  SnapshotProposalProjectionApplier,
  SnapshotProposalRepository,
  createSnapshotPlugin,
  makeSnapshotReadExtension,
  type SnapshotStaleProvider,
} from '@sources/snapshot';
import { toChainLogger } from '@nest/chain';

export const SNAPSHOT_SOURCE_PLUGIN = 'SNAPSHOT_SOURCE_PLUGIN';

// Reconcile re-queries up to this many stale closed proposals per space per poll tick.
const RECONCILE_BATCH = Number(process.env['SNAPSHOT_RECONCILE_BATCH'] ?? '25');

// Off-chain source: one `snapshot` plugin covering all three seeded spaces (lido/aave/compound).
// AD2 adds the proposal projection applier + proposer actor adapter (the off-chain derivation
// foundation dispatches them) and the closed-proposal reconcile pass. Registering here starts live
// polling + derivation on boot (gated by INDEXER_LIVE_POLLER_ENABLED).
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
          derivers: [proposalApplier, actorAddressDeriver],
          readExtension: makeSnapshotReadExtension(),
        };
      },
    },
  ],
  exports: [SNAPSHOT_SOURCE_PLUGIN],
})
export class SnapshotSourceModule {}
