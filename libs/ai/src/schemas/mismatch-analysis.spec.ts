import { describe, expect, it } from 'vitest';
import { MismatchAnalysisSchema, MISMATCH_ANALYSIS_SCHEMA_NAME } from './mismatch-analysis.js';

const VALID = {
  overall_assessment: 'material_discrepancy' as const,
  confidence: 'high' as const,
  description_actions: [{ claim: 'Raises the reserve factor to 5%', location: 'paragraph 2' }],
  calldata_actions: [
    { action_index: 0, summary: 'setReserveFactor(50%)', significance: 'high' as const },
  ],
  discrepancies: [
    {
      type: 'value_mismatch' as const,
      description: 'Description says 5%, calldata sets 50%.',
      severity: 'high' as const,
      description_excerpt: 'raise the reserve factor to 5%',
      related_action_indices: [0],
    },
  ],
  reasoning: 'The calldata sets 5e17 (50%) but the prose says 5%.',
};

describe('MismatchAnalysisSchema', () => {
  it('accepts a valid analysis', () => {
    const parsed = MismatchAnalysisSchema.parse(VALID);
    expect(parsed.overall_assessment).toBe('material_discrepancy');
    expect(parsed.discrepancies[0]?.related_action_indices).toEqual([0]);
  });

  it('accepts an empty discrepancies array (consistent proposal)', () => {
    expect(
      MismatchAnalysisSchema.safeParse({
        ...VALID,
        overall_assessment: 'consistent',
        discrepancies: [],
      }).success,
    ).toBe(true);
  });

  it('allows a null description_excerpt', () => {
    const parsed = MismatchAnalysisSchema.parse({
      ...VALID,
      discrepancies: [{ ...VALID.discrepancies[0]!, description_excerpt: null }],
    });
    expect(parsed.discrepancies[0]?.description_excerpt).toBeNull();
  });

  it('rejects an unknown overall_assessment', () => {
    expect(
      MismatchAnalysisSchema.safeParse({ ...VALID, overall_assessment: 'nonsense' }).success,
    ).toBe(false);
  });

  it('rejects an unknown discrepancy type', () => {
    const bad = [{ ...VALID.discrepancies[0]!, type: 'made_up' }];
    expect(MismatchAnalysisSchema.safeParse({ ...VALID, discrepancies: bad }).success).toBe(false);
  });

  it('rejects reasoning longer than 2000 chars', () => {
    expect(
      MismatchAnalysisSchema.safeParse({ ...VALID, reasoning: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });

  it('exposes the schema-label constant used by the template registry', () => {
    expect(MISMATCH_ANALYSIS_SCHEMA_NAME).toBe('MismatchAnalysisSchema');
  });
});
