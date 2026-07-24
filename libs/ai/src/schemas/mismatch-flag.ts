import type { MismatchAnalysis } from './mismatch-analysis.js';

export interface AiMismatchFlag {
  assessment: 'material_discrepancy' | 'severe_discrepancy';
  summary: string;
}

const SURFACED_ASSESSMENTS = new Set<MismatchAnalysis['overall_assessment']>([
  'material_discrepancy',
  'severe_discrepancy',
]);
const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * The conservative surfacing threshold (SPEC §5.6, ADR-080). A proposal carries an `ai_mismatch_flag`
 * ONLY when the analysis is `material`/`severe` **and** not `low`-confidence — a low-confidence
 * output is still stored and exposed via the dedicated endpoint, but never surfaced as a flag.
 * The `summary` is the highest-severity discrepancy's description. This is the single source of the
 * flag policy: the API field and #441's measurement harness both call it.
 */
export function mismatchFlag(analysis: MismatchAnalysis): AiMismatchFlag | null {
  if (!SURFACED_ASSESSMENTS.has(analysis.overall_assessment)) return null;
  if (analysis.confidence === 'low') return null;

  const assessment = analysis.overall_assessment as AiMismatchFlag['assessment'];
  // Stable sort → highest severity first; ties keep source order (i.e. the first such discrepancy).
  const top = [...analysis.discrepancies].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  )[0];
  const summary = top?.description ?? `A ${assessment.replace('_', ' ')} was detected.`;
  return { assessment, summary };
}
