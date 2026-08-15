import { type Kysely, sql } from 'kysely';
import type { PgDatabase } from '@libs/db';

// The four AI features + their monthly USD caps. Duplicated here (not imported from the ai-worker's
// budget-config) for the same reason AI_REGENERATE_QUEUES is duplicated: admin-cli must not depend on
// the worker. Keep in sync with apps/ai-worker/src/budget/budget-config.ts (SPEC §5.3 defaults, $41 total).
const CAP_ENV: Record<string, string> = {
  proposal_summarizer: 'AI_CAP_SUMMARIZE_USD',
  mismatch_detector: 'AI_CAP_MISMATCH_USD',
  forum_synthesizer: 'AI_CAP_FORUM_SYNTHESIS_USD',
  embedding: 'AI_CAP_EMBED_USD',
};
const DEFAULT_CAP_USD: Record<string, number> = {
  proposal_summarizer: 5,
  mismatch_detector: 20,
  forum_synthesizer: 15,
  embedding: 1,
};
export const AI_FEATURES = Object.keys(CAP_ENV);

/** Per-feature monthly cap (USD): the env override if a positive finite number, else the SPEC default. */
export function readCapUsd(feature: string): number {
  const raw = process.env[CAP_ENV[feature] ?? ''];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : (DEFAULT_CAP_USD[feature] ?? 0);
}

/** Start of the current calendar month in UTC — the window the budget cap measures month-to-date spend over. */
export function startOfCurrentMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface FeatureCost {
  feature: string;
  spendUsd: number;
  capUsd: number;
  utilizationPct: number;
  disabled: boolean;
}
export interface CostReport {
  since: string;
  perFeature: FeatureCost[];
  totalSpendUsd: number;
  ceilingUsd: number;
}

/** Pure: fold per-feature (spend, cap) into the report the cost command prints. Mirrors the budget cap's
 *  contract — `disabled = spend >= cap` (exactly-at-cap disables), utilization is spend as % of cap. */
export function buildCostReport(
  rows: { feature: string; spendUsd: number; capUsd: number }[],
  since: Date,
): CostReport {
  const perFeature = rows.map((r) => ({
    feature: r.feature,
    spendUsd: r.spendUsd,
    capUsd: r.capUsd,
    utilizationPct: r.capUsd > 0 ? (r.spendUsd / r.capUsd) * 100 : 0,
    disabled: r.spendUsd >= r.capUsd,
  }));
  return {
    since: since.toISOString(),
    perFeature,
    totalSpendUsd: perFeature.reduce((sum, r) => sum + r.spendUsd, 0),
    ceilingUsd: perFeature.reduce((sum, r) => sum + r.capUsd, 0),
  };
}

/** Query month-to-date spend per feature from `ai_cost_log` (raw SQL so admin-cli needs no ai-schema
 *  types), then build the report. `db` is the shared pgDb; `now` is injected for testability. */
export async function queryCostReport(db: Kysely<PgDatabase>, now: Date): Promise<CostReport> {
  const since = startOfCurrentMonthUtc(now);
  const rows = await Promise.all(
    AI_FEATURES.map(async (feature) => {
      const res = await sql<{ total: string }>`
        SELECT COALESCE(SUM(cost_usd), 0) AS total
        FROM ai_cost_log
        WHERE feature_name = ${feature} AND timestamp >= ${since}
      `.execute(db);
      return {
        feature,
        spendUsd: Number(res.rows[0]?.total ?? 0),
        capUsd: readCapUsd(feature),
      };
    }),
  );
  return buildCostReport(rows, since);
}

/** Render the report as a human-readable table + the ceiling summary. */
export function renderCostReport(report: CostReport): string {
  const lines = [
    `AI spend, month-to-date (since ${report.since}):`,
    ...report.perFeature.map(
      (r) =>
        `  ${r.feature.padEnd(20)} $${r.spendUsd.toFixed(4)} / $${r.capUsd.toFixed(2)} ` +
        `(${r.utilizationPct.toFixed(1)}%)${r.disabled ? ' [DISABLED]' : ''}`,
    ),
    `  ${'TOTAL'.padEnd(20)} $${report.totalSpendUsd.toFixed(4)} / $${report.ceilingUsd.toFixed(2)} ceiling`,
  ];
  return lines.join('\n');
}
