import { Module } from '@nestjs/common';
import { chDb } from '@libs/db';
import type { SourcePlugin } from '@sources/core';
import { SnapshotClient, createSnapshotPlugin, makeSnapshotReadExtension } from '@sources/snapshot';

export const SNAPSHOT_SOURCE_PLUGIN = 'SNAPSHOT_SOURCE_PLUGIN';

// Off-chain source: one `snapshot` plugin covering all three seeded spaces (lido/aave/compound).
// No derivers in AD1 — the orchestrator polls + archives raw; AD2/AD3/AD4/AD5 add derivation.
// Registering here starts live polling on boot (gated by INDEXER_LIVE_POLLER_ENABLED).
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
        return {
          name: 'snapshot',
          ingesters: [
            createSnapshotPlugin({
              client,
              chDb,
              intervalMs: intervalEnv ? Number(intervalEnv) : undefined,
            }),
          ],
          derivers: [],
          readExtension: makeSnapshotReadExtension(),
        };
      },
    },
  ],
  exports: [SNAPSHOT_SOURCE_PLUGIN],
})
export class SnapshotSourceModule {}
