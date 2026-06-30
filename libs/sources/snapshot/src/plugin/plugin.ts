import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { ClickHouseDatabase } from '@libs/db';
import type { SourceIngester } from '@sources/core';
import type { SnapshotClient } from '../client/client';
import { makeSnapshotOffChainArchiveWriter } from '../ingestion/archive-writer';
import { makeSnapshotPollListener, type SnapshotStaleProvider } from '../ingestion/poll-listener';

// One `snapshot` source per space; the seeded source_config is `{ space }`.
export const SnapshotConfigSchema = z.object({
  space: z.string().min(1),
});

export type SnapshotConfig = z.infer<typeof SnapshotConfigSchema>;

// Off-chain sentinel chain_id (ADR-071); matches the snapshot_002 seed.
export const SUPPORTED_CHAIN_IDS = ['off-chain'] as const;

export const DEFAULT_POLL_INTERVAL_MS = 60_000;

export interface SnapshotPluginDeps {
  client: SnapshotClient;
  chDb: Kysely<ClickHouseDatabase>;
  intervalMs?: number;
  pageSize?: number;
  /** Per-space reconcile stale-provider factory (AD2). Omitted → forward-only polling. */
  staleProviderFactory?: (space: string) => SnapshotStaleProvider;
}

export function createSnapshotPlugin(deps: SnapshotPluginDeps): SourceIngester<SnapshotConfig> {
  const intervalMs = deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  return {
    sourceType: 'snapshot',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => SnapshotConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'poll',
      listener: makeSnapshotPollListener(
        {
          client: deps.client,
          space: cfg.space,
          pageSize: deps.pageSize,
          staleProvider: deps.staleProviderFactory?.(cfg.space),
        },
        intervalMs,
      ),
    }),
    // Off-chain: no EVM backfill runtime, no ABI archive consumer. The poll path is the only
    // ingest route; the generic off-chain consumer drives this writer.
    buildOffChainArchiveWriter: () => makeSnapshotOffChainArchiveWriter({ chDb: deps.chDb }),
  };
}
