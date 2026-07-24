import type { MismatchCorpusCase } from './mismatch-corpus.js';
import type { MismatchAnalysis } from '../schemas/mismatch-analysis.js';
import { mismatchFlag } from '../schemas/mismatch-flag.js';

export type CaseOutcome = 'tp' | 'tn' | 'fp' | 'fn';

export interface EvalCaseResult {
  id: string;
  expectedFlag: boolean;
  predictedFlag: boolean;
  outcome: CaseOutcome;
  /** For a seeded case: did the analysis surface at least one of the seeded discrepancy types? Null
   *  when the case has no seeds. */
  seededCaught: boolean | null;
}

export interface EvalSummary {
  total: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  /** False positives among the should-NOT-flag cases: fp / (fp + tn). The AC #5 gate is < 5%. */
  fpRate: number;
  /** Missed flags among the should-flag cases: fn / (fn + tp). */
  fnRate: number;
  /** Fraction of seeded cases whose seeded discrepancy the model surfaced (null when no seeds). */
  seededCaughtRate: number | null;
  passed: boolean;
  cases: EvalCaseResult[];
}

export interface EvalEntry {
  case: MismatchCorpusCase;
  analysis: MismatchAnalysis;
}

/** AC #5: the mismatch detector must keep the false-positive rate below this on the corpus. */
export const FP_GATE = 0.05;

function outcomeOf(expected: boolean, predicted: boolean): CaseOutcome {
  if (expected) return predicted ? 'tp' : 'fn';
  return predicted ? 'fp' : 'tn';
}

function seededCaught(c: MismatchCorpusCase, analysis: MismatchAnalysis): boolean | null {
  const seeds = c.expected.seeded_discrepancy_types;
  if (seeds === undefined || seeds.length === 0) return null;
  const found = new Set(analysis.discrepancies.map((d) => d.type));
  return seeds.some((type) => found.has(type));
}

/**
 * Score a run of the mismatch detector against the labeled corpus. Prediction reuses the exact #440
 * surfacing policy (`mismatchFlag`), so the eval measures what users would actually see. `passed`
 * requires FP rate below the gate AND every seeded discrepancy caught (AC #5).
 */
export function scoreEval(entries: EvalEntry[]): EvalSummary {
  const cases: EvalCaseResult[] = entries.map(({ case: c, analysis }) => {
    const expectedFlag = c.expected.should_flag;
    const predictedFlag = mismatchFlag(analysis) !== null;
    return {
      id: c.id,
      expectedFlag,
      predictedFlag,
      outcome: outcomeOf(expectedFlag, predictedFlag),
      seededCaught: seededCaught(c, analysis),
    };
  });

  const count = (o: CaseOutcome): number => cases.filter((c) => c.outcome === o).length;
  const tp = count('tp');
  const tn = count('tn');
  const fp = count('fp');
  const fn = count('fn');
  const fpRate = fp + tn === 0 ? 0 : fp / (fp + tn);
  const fnRate = fn + tp === 0 ? 0 : fn / (fn + tp);

  const seeded = cases.filter((c) => c.seededCaught !== null);
  const seededCaughtRate =
    seeded.length === 0 ? null : seeded.filter((c) => c.seededCaught).length / seeded.length;
  const allSeedsCaught = seeded.every((c) => c.seededCaught);

  return {
    total: cases.length,
    tp,
    tn,
    fp,
    fn,
    fpRate,
    fnRate,
    seededCaughtRate,
    passed: fpRate < FP_GATE && allSeedsCaught,
    cases,
  };
}
