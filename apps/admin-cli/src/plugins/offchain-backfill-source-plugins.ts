import { chDb } from '@libs/db';
import type { JsonValue } from '@libs/domain';
import type {
  IngestSpec,
  OffChainArchiveWriteFn,
  PollListener,
  SourceContext,
  SourceIngester,
} from '@sources/core';
import { createForumPlugin } from '@sources/forum';
import { createSnapshotPlugin, SnapshotClient } from '@sources/snapshot';

/** UA sent on Discourse backfill requests (the anonymous API is User-Agent-sensitive; ADR-071). */
const DEFAULT_BACKFILL_USER_AGENT = 'kvorum-backfill/1.0 (+https://kvorum.watch)';

/** A very long reconcile interval keeps the Discourse crawl forward-only for the bounded backfill —
 *  a from-genesis sweep runs once; the periodic re-crawl belongs to live polling (ADR-052). */
const RECONCILE_DISABLED_MS = Number.MAX_SAFE_INTEGER;

export interface OffChainBackfillSource {
  listener: PollListener<JsonValue>;
  write: OffChainArchiveWriteFn;
}

/** True for source_types whose backfill runs over the off-chain poll transport (no EVM block range). */
export function isOffChainBackfillSourceType(sourceType: string): boolean {
  return sourceType === 'snapshot' || sourceType === 'discourse_forum';
}

/**
 * Resolves an off-chain source_type + config to its poll listener + per-source CH writer for a
 * from-genesis backfill drain. Forward-only: the Snapshot closed-proposal reconcile
 * (`staleProviderFactory`) and the Discourse periodic re-crawl are omitted — a backfill sweeps history
 * once, so the closed-proposal / edit re-query stays with live polling.
 */
export function buildOffChainBackfillSource(input: {
  sourceType: string;
  sourceConfig: unknown;
  ctx: SourceContext;
}): OffChainBackfillSource {
  if (input.sourceType === 'snapshot') {
    // No production mirror hub (ADR-071); the client retries/backoffs on the single hub. An API key
    // (SNAPSHOT_API_KEY) raises the rate limit for the heavy from-genesis sweep.
    const client = new SnapshotClient({ apiKey: process.env['SNAPSHOT_API_KEY'] });
    const plugin = createSnapshotPlugin({ client, chDb }); // no staleProviderFactory → forward-only
    return resolve(plugin, input.sourceConfig, input.ctx);
  }
  if (input.sourceType === 'discourse_forum') {
    const plugin = createForumPlugin({
      chDb,
      clientOptions: { userAgent: DEFAULT_BACKFILL_USER_AGENT },
      reconcileIntervalMs: RECONCILE_DISABLED_MS,
    });
    return resolve(plugin, input.sourceConfig, input.ctx);
  }
  throw new Error(`source_type '${input.sourceType}' is not an off-chain backfill source`);
}

function resolve<TConfig>(
  plugin: SourceIngester<TConfig>,
  rawConfig: unknown,
  ctx: SourceContext,
): OffChainBackfillSource {
  const cfg = plugin.parseConfig(rawConfig);
  const spec: IngestSpec = plugin.buildIngestSpec(ctx, cfg);
  if (spec.kind !== 'poll') {
    throw new Error(`expected a poll ingest spec for ${plugin.sourceType}, got ${spec.kind}`);
  }
  if (plugin.buildOffChainArchiveWriter == null) {
    throw new Error(`${plugin.sourceType} has no off-chain archive writer`);
  }
  return {
    listener: spec.listener as PollListener<JsonValue>,
    write: plugin.buildOffChainArchiveWriter(),
  };
}
