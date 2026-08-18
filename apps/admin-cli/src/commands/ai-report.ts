import { type Kysely, sql } from 'kysely';
import type { PgDatabase } from '@libs/db';
import { AI_FEATURES, buildCostReport, type FeatureCost, readCapUsd } from './ai-cost.js';

// SPEC §7.8 / DR-017: typical monthly LLM spend is ~$12 (~30% of the $41 ceiling). The monthly
// cost-attribution report surfaces the deviation of actual spend from this "typical estimate".
export const TYPICAL_MONTHLY_USD = 12;

export interface MonthWindow {
  since: Date; // inclusive lower bound
  until: Date; // exclusive upper bound
  label: string; // 'YYYY-MM'
}

function monthLabel(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The previous full calendar month `[first-of-prev, first-of-this)` in UTC — the report's default window
 *  (a monthly job run on the 1st reports the month that just closed). */
export function resolvePreviousMonthWindow(now: Date): MonthWindow {
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { since, until, label: monthLabel(since) };
}

/** An explicit `YYYY-MM` → its `[first, next-first)` UTC window; an error string if malformed. */
export function resolveMonthWindow(month: string): MonthWindow | { error: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (m === null) return { error: `invalid --month '${month}' (expected YYYY-MM)` };
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return { error: `invalid --month '${month}' (month must be 01-12)` };
  return {
    since: new Date(Date.UTC(year, mon - 1, 1)),
    until: new Date(Date.UTC(year, mon, 1)),
    label: `${m[1]}-${m[2]}`,
  };
}

export interface CategorySpend {
  key: string;
  spendUsd: number;
}
export interface MonthlyCostReport {
  window: { since: string; until: string; label: string };
  perFeature: FeatureCost[];
  byModel: CategorySpend[];
  byDao: CategorySpend[];
  totalSpendUsd: number;
  ceilingUsd: number;
  typicalUsd: number;
  deviationPct: number; // (total − typical) / typical × 100
}

/** Pure: fold the windowed rows into the cost-attribution report. Reuses `buildCostReport` for the
 *  per-feature/cap section (and its total/ceiling), then adds the by-model + by-DAO breakdowns
 *  (spend-descending) and the deviation of total spend from the typical estimate. */
export function buildMonthlyReport(
  featureRows: { feature: string; spendUsd: number; capUsd: number }[],
  modelRows: CategorySpend[],
  daoRows: CategorySpend[],
  window: MonthWindow,
): MonthlyCostReport {
  const base = buildCostReport(featureRows, window.since);
  const bySpendDesc = (a: CategorySpend, b: CategorySpend) => b.spendUsd - a.spendUsd;
  return {
    window: {
      since: window.since.toISOString(),
      until: window.until.toISOString(),
      label: window.label,
    },
    perFeature: base.perFeature,
    byModel: [...modelRows].sort(bySpendDesc),
    byDao: [...daoRows].sort(bySpendDesc),
    totalSpendUsd: base.totalSpendUsd,
    ceilingUsd: base.ceilingUsd,
    typicalUsd: TYPICAL_MONTHLY_USD,
    deviationPct:
      TYPICAL_MONTHLY_USD > 0
        ? ((base.totalSpendUsd - TYPICAL_MONTHLY_USD) / TYPICAL_MONTHLY_USD) * 100
        : 0,
  };
}

/** Query `ai_cost_log` for a bounded month window (raw SQL so admin-cli needs no ai-schema types): the
 *  per-feature sums (all four features, even zero-spend), the by-model rollup, and the by-DAO rollup
 *  (left-joined to `dao` for slug labels; NULL `dao_id` — e.g. system/embedding rows — buckets under
 *  `(system/no-dao)`). The `ai_cost_log` cost is the LLM category only (§7.8's other categories come from
 *  external billing APIs not ingested here). */
export async function queryMonthlyCostReport(
  db: Kysely<PgDatabase>,
  window: MonthWindow,
): Promise<MonthlyCostReport> {
  const featureRows = await Promise.all(
    AI_FEATURES.map(async (feature) => {
      const res = await sql<{ total: string }>`
        SELECT COALESCE(SUM(cost_usd), 0) AS total
        FROM ai_cost_log
        WHERE feature_name = ${feature}
          AND timestamp >= ${window.since} AND timestamp < ${window.until}
      `.execute(db);
      return { feature, spendUsd: Number(res.rows[0]?.total ?? 0), capUsd: readCapUsd(feature) };
    }),
  );

  const modelRes = await sql<{ model: string; total: string }>`
    SELECT model, COALESCE(SUM(cost_usd), 0) AS total
    FROM ai_cost_log
    WHERE timestamp >= ${window.since} AND timestamp < ${window.until}
    GROUP BY model
  `.execute(db);
  const byModel = modelRes.rows.map((r) => ({ key: r.model, spendUsd: Number(r.total) }));

  const daoRes = await sql<{ slug: string | null; total: string }>`
    SELECT d.slug AS slug, COALESCE(SUM(c.cost_usd), 0) AS total
    FROM ai_cost_log c
    LEFT JOIN dao d ON d.id = c.dao_id
    WHERE c.timestamp >= ${window.since} AND c.timestamp < ${window.until}
    GROUP BY d.slug
  `.execute(db);
  const byDao = daoRes.rows.map((r) => ({
    key: r.slug ?? '(system/no-dao)',
    spendUsd: Number(r.total),
  }));

  return buildMonthlyReport(featureRows, byModel, byDao, window);
}

const signed = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;

/** Render the monthly cost-attribution report as human-readable tables + the total-vs-typical-vs-ceiling line. */
export function renderMonthlyReport(report: MonthlyCostReport): string {
  const category = (rows: CategorySpend[]) =>
    rows.length > 0
      ? rows.map((r) => `  ${r.key.padEnd(28)} $${r.spendUsd.toFixed(4)}`)
      : ['  (none)'];
  return [
    `AI cost-attribution report — ${report.window.label} (${report.window.since} … ${report.window.until}):`,
    ``,
    `By feature (spend / cap):`,
    ...report.perFeature.map(
      (r) =>
        `  ${r.feature.padEnd(20)} $${r.spendUsd.toFixed(4)} / $${r.capUsd.toFixed(2)} ` +
        `(${r.utilizationPct.toFixed(1)}%)${r.disabled ? ' [DISABLED]' : ''}`,
    ),
    ``,
    `By model:`,
    ...category(report.byModel),
    ``,
    `By DAO:`,
    ...category(report.byDao),
    ``,
    `Total $${report.totalSpendUsd.toFixed(4)}  |  typical ~$${report.typicalUsd.toFixed(2)}  |  ` +
      `ceiling $${report.ceilingUsd.toFixed(2)}  |  deviation ${signed(report.deviationPct)} vs typical`,
  ].join('\n');
}
