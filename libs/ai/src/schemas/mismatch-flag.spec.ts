import { describe, expect, it } from 'vitest';
import type { MismatchAnalysis } from './mismatch-analysis.js';
import { mismatchFlag } from './mismatch-flag.js';

function analysis(over: Partial<MismatchAnalysis> = {}): MismatchAnalysis {
  return {
    overall_assessment: 'material_discrepancy',
    confidence: 'high',
    description_actions: [],
    calldata_actions: [],
    discrepancies: [
      {
        type: 'value_mismatch',
        description: 'Says 5%, sets 50%.',
        severity: 'high',
        description_excerpt: null,
        related_action_indices: [0],
      },
    ],
    reasoning: 'r',
    ...over,
  };
}

describe('mismatchFlag', () => {
  it('surfaces a material discrepancy with the highest-severity description', () => {
    expect(mismatchFlag(analysis())).toEqual({
      assessment: 'material_discrepancy',
      summary: 'Says 5%, sets 50%.',
    });
  });

  it('surfaces a severe discrepancy at medium confidence', () => {
    const flag = mismatchFlag(
      analysis({ overall_assessment: 'severe_discrepancy', confidence: 'medium' }),
    );
    expect(flag?.assessment).toBe('severe_discrepancy');
  });

  it('does not surface a consistent proposal', () => {
    expect(
      mismatchFlag(analysis({ overall_assessment: 'consistent', discrepancies: [] })),
    ).toBeNull();
  });

  it('does not surface a minor discrepancy', () => {
    expect(mismatchFlag(analysis({ overall_assessment: 'minor_discrepancy' }))).toBeNull();
  });

  it('does not surface low-confidence output even when material', () => {
    expect(mismatchFlag(analysis({ confidence: 'low' }))).toBeNull();
  });

  it('picks the highest-severity discrepancy for the summary', () => {
    const flag = mismatchFlag(
      analysis({
        discrepancies: [
          {
            type: 'misleading_phrasing',
            description: 'low one',
            severity: 'low',
            description_excerpt: null,
            related_action_indices: [],
          },
          {
            type: 'value_mismatch',
            description: 'high one',
            severity: 'high',
            description_excerpt: null,
            related_action_indices: [1],
          },
          {
            type: 'target_mismatch',
            description: 'medium one',
            severity: 'medium',
            description_excerpt: null,
            related_action_indices: [],
          },
        ],
      }),
    );
    expect(flag?.summary).toBe('high one');
  });

  it('falls back to a non-empty summary when material with no discrepancies', () => {
    const flag = mismatchFlag(analysis({ discrepancies: [] }));
    expect(flag?.assessment).toBe('material_discrepancy');
    expect(flag?.summary.length).toBeGreaterThan(0);
  });
});
