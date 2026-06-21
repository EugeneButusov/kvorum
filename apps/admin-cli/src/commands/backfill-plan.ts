import { normalizeChainId } from '@libs/chain';

/** A dao_source row with the full backfill shape, as returned by findSourcesByDaoSlug. */
export interface BackfillTarget {
  id: string;
  source_type: string;
  chain_id: string;
  source_config: unknown;
  active_from_block: string | null;
  backfill_started_at_block: string | null;
  backfill_head_block: string | null;
}

/**
 * Mainnet governance spine — backfilled serially and first so proposal/payload-declaration rows
 * exist before dependent votes/executions arrive. Order within the spine is intentional:
 * governance_v3 declares its payloads via PayloadSent, so it leads. (Ordering is an optimization,
 * not a correctness requirement — the derivation indefinite-hold tolerates any arrival order.)
 */
const SPINE_ORDER: readonly string[] = ['aave_governance_v3', 'aave_governor_v2', 'aave_token'];
const SPINE_TYPES = new Set<string>(SPINE_ORDER);

export interface BackfillPlan {
  /** Mainnet spine, run serially in SPINE_ORDER. */
  phase1: BackfillTarget[];
  /** Voting machines + payloads controllers, run bounded-parallel. */
  phase2: BackfillTarget[];
  /** Deprecated-chain sources excluded when --skip-deprecated is set. */
  skippedDeprecated: BackfillTarget[];
}

function isDeprecated(target: BackfillTarget): boolean {
  const cfg = target.source_config;
  return (
    typeof cfg === 'object' &&
    cfg !== null &&
    (cfg as Record<string, unknown>)['deprecated'] === true
  );
}

/**
 * Builds the ordered backfill plan from a DAO's source rows: keeps only EVM-backfillable sources
 * (`opts.isBackfillable`, backed by the plugins' declared `transport` — see
 * isBackfillableSourceType; this excludes reconcile sweeps and off-chain Snapshot/Discourse sources
 * whose backfill is a separate transport owned by AG1, ADR-0073), optionally drops deprecated-chain
 * sources, and splits the rest into the serial mainnet spine (phase 1) and the bounded-parallel
 * remainder (phase 2).
 */
export function planBackfillOrder(
  rows: readonly BackfillTarget[],
  opts: { skipDeprecated: boolean; isBackfillable: (sourceType: string) => boolean },
): BackfillPlan {
  const backfillable = rows.filter((r) => opts.isBackfillable(r.source_type));
  const skippedDeprecated: BackfillTarget[] = [];
  const live: BackfillTarget[] = [];
  for (const r of backfillable) {
    if (opts.skipDeprecated && isDeprecated(r)) skippedDeprecated.push(r);
    else live.push(r);
  }
  const phase1 = live
    .filter((r) => SPINE_TYPES.has(r.source_type))
    .sort((a, b) => SPINE_ORDER.indexOf(a.source_type) - SPINE_ORDER.indexOf(b.source_type));
  const phase2 = live.filter((r) => !SPINE_TYPES.has(r.source_type));
  return { phase1, phase2, skippedDeprecated };
}

/** Chain ids present among the targets but absent from CHAIN_CONFIG (a readiness-gate failure). */
export function findMissingChainConfigs(
  targets: readonly BackfillTarget[],
  chainConfigs: readonly { chainId: string }[],
): string[] {
  const present = new Set(chainConfigs.map((c) => normalizeChainId(c.chainId)));
  const missing = new Set<string>();
  for (const t of targets) {
    const id = normalizeChainId(t.chain_id);
    if (!present.has(id)) missing.add(id);
  }
  return [...missing];
}

export type BackfillSourceMode = 'fresh' | 'resume' | 'skip';

/**
 * Per-source backfill mode (D6): resume an in-flight backfill (captured head present); skip a
 * source whose archive already reaches the confirmed head; otherwise run fresh. Re-running a
 * completed source is safe regardless (ADR-041 idempotent writes) — skip only avoids the re-scan.
 */
export function selectBackfillMode(
  target: Pick<BackfillTarget, 'backfill_started_at_block'>,
  archivedHead: bigint | null,
  confirmedHead: bigint,
): BackfillSourceMode {
  if (target.backfill_started_at_block != null) return 'resume';
  if (archivedHead != null && archivedHead >= confirmedHead) return 'skip';
  return 'fresh';
}
