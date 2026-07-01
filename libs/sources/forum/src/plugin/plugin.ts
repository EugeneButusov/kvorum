import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { SourceIngester } from '@sources/core';
import { parseForumConfig, type ForumConfig } from './config';
import { DiscourseClient, type DiscourseClientOptions } from '../client/client';
import { makeForumOffChainArchiveWriter } from '../ingestion/archive-writer';
import { makeForumPollListener } from '../ingestion/poll-listener';

// Off-chain sentinel chain_id (ADR-071); matches the forum_002 seed.
export const SUPPORTED_CHAIN_IDS = ['off-chain'] as const;

// Chunk cadence: each tick does one bounded unit (drain a few threads OR enumerate one page), so a
// short interval crawls steadily while the per-host rate pacer keeps request rate polite.
export const DEFAULT_FORUM_POLL_INTERVAL_MS = 15_000;

export interface ForumPluginDeps {
  chDb: Kysely<ClickHouseDatabase>;
  /** Client tuning applied to every per-host DiscourseClient (UA, retries, rate pacer). */
  clientOptions?: Omit<DiscourseClientOptions, 'baseUrl'>;
  intervalMs?: number;
  maxThreadsPerTick?: number;
  reconcileIntervalMs?: number;
}

/** One `discourse_forum` ingester covering every configured DAO forum. Unlike Snapshot's
 *  host-agnostic client, the Discourse client is host-bound, so a fresh client is built per source
 *  from `cfg.host` inside buildIngestSpec. */
export function createForumPlugin(deps: ForumPluginDeps): SourceIngester<ForumConfig> {
  const intervalMs = deps.intervalMs ?? DEFAULT_FORUM_POLL_INTERVAL_MS;

  return {
    sourceType: 'discourse_forum',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => parseForumConfig(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'poll',
      listener: makeForumPollListener(
        {
          client: new DiscourseClient({ baseUrl: `https://${cfg.host}`, ...deps.clientOptions }),
          host: cfg.host,
          categorySlugs: cfg.categories,
          maxThreadsPerTick: deps.maxThreadsPerTick,
          reconcileIntervalMs: deps.reconcileIntervalMs,
        },
        intervalMs,
      ),
    }),
    // Off-chain: no EVM backfill runtime, no ABI archive consumer. The generic off-chain consumer
    // drives this writer.
    buildOffChainArchiveWriter: () => makeForumOffChainArchiveWriter({ chDb: deps.chDb }),
  };
}
