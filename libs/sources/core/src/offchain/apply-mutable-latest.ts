import type { ArchiveEventRepository } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ArchiveConsumeContext, OffChainArchiveWriteFn } from '../index';

/** One off-chain item to archive under mutable-latest semantics (ADR-071). */
export interface MutableLatestItem {
  externalId: string;
  contentHash: string;
  ordinal: string | null;
  eventType: ArchiveEventType;
  payload: unknown;
}

/** What `applyOffChainMutableLatest` did, so the caller can tag its own metrics. */
export type MutableLatestOutcome = 'skip_unchanged' | 'inserted' | 're_archived';

/** The `archive_event` operations the mutable-latest core needs — a structural slice of
 *  ArchiveEventRepository so both the Nest consumer and the admin-cli backfill --direct sink can
 *  supply the same repo without either owning the routine. */
export type OffChainArchiveStore = Pick<
  ArchiveEventRepository,
  'findByExternalId' | 'insert' | 'reArchiveOffchain'
>;

export interface ApplyMutableLatestDeps {
  archiveEventRepo: OffChainArchiveStore;
  /** Per-source CH writer (from the plugin's buildOffChainArchiveWriter). */
  write: OffChainArchiveWriteFn;
  now?: () => Date;
}

/**
 * The off-chain mutable-latest write (ADR-071 §off-chain consumer): CH-first then the PG watermark,
 * with a PG-maintained monotonic `version` bumped only on a content change. Extracted from the Nest
 * OffChainArchiveConsumer so the admin-cli backfill --direct sink shares the exact same routine (no
 * drift between the live-poll and backfill paths). Callers own source resolution, writer lookup,
 * metrics, and DLQ/retry; this owns only the read-modify-write.
 *
 * NOT internally atomic — callers MUST serialize per source (the consumer uses localConcurrency:1;
 * the backfill drain runs single-flight), matching the ADR-071 single-worker-per-source invariant.
 */
export async function applyOffChainMutableLatest(
  ctx: ArchiveConsumeContext,
  item: MutableLatestItem,
  deps: ApplyMutableLatestDeps,
): Promise<MutableLatestOutcome> {
  const existing = await deps.archiveEventRepo.findByExternalId({
    sourceType: ctx.sourceType,
    chainId: ctx.chainId,
    externalId: item.externalId,
  });

  // At-least-once safety net: an unchanged re-delivery is a no-op, not just an efficiency win.
  if (existing && existing.content_hash === item.contentHash) {
    return 'skip_unchanged';
  }

  // PG-maintained monotonic version, bumped only on content change; the CH
  // ReplacingMergeTree(version) sort key so the latest edit wins deterministically.
  const version = existing ? (existing.version ?? 0) + 1 : 1;

  // CH-first (per-source, idempotent on (external_id, version)).
  await deps.write(ctx, {
    externalId: item.externalId,
    contentHash: item.contentHash,
    ordinal: item.ordinal,
    version,
    payload: item.payload,
  });

  if (!existing) {
    await deps.archiveEventRepo.insert({
      source_type: ctx.sourceType,
      dao_source_id: ctx.daoSourceId,
      chain_id: ctx.chainId,
      external_id: item.externalId,
      content_hash: item.contentHash,
      version,
      derivation_ordinal: item.ordinal,
      event_type: item.eventType,
      received_at: (deps.now ?? (() => new Date()))(),
      derived_at: null,
    });
    return 'inserted';
  }

  // CAS-guarded update + full derivation-watermark reset (ADR-071).
  await deps.archiveEventRepo.reArchiveOffchain(
    { sourceType: ctx.sourceType, chainId: ctx.chainId, externalId: item.externalId },
    { contentHash: item.contentHash, version, ordinal: item.ordinal },
  );
  return 're_archived';
}
