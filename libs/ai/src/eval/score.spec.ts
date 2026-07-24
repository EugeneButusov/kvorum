import { describe, expect, it } from 'vitest';
import type { MismatchCorpusCase } from './mismatch-corpus.js';
import { scoreEval } from './score.js';
import type { MismatchAnalysis } from '../schemas/mismatch-analysis.js';

function analysis(over: Partial<MismatchAnalysis> = {}): MismatchAnalysis {
  return {
    overall_assessment: 'consistent',
    confidence: 'high',
    description_actions: [],
    calldata_actions: [],
    discrepancies: [],
    reasoning: 'r',
    ...over,
  };
}

const flaggingValueMismatch = analysis({
  overall_assessment: 'material_discrepancy',
  confidence: 'high',
  discrepancies: [
    {
      type: 'value_mismatch',
      description: '5% vs 50%',
      severity: 'high',
      description_excerpt: null,
      related_action_indices: [0],
    },
  ],
});

function corpusCase(
  over: Partial<MismatchCorpusCase> & Pick<MismatchCorpusCase, 'id'>,
): MismatchCorpusCase {
  return {
    dao: 'compound',
    description: 'body',
    decoded_actions: [
      {
        action_index: 0,
        target_address: '0xtarget',
        target_chain_id: '1',
        value_wei: '0',
        function_signature: 'f()',
        decoded_function: 'f',
        decoded_arguments: null,
      },
    ],
    expected: { should_flag: false, notes: 'n' },
    ...over,
  };
}

describe('scoreEval', () => {
  it('classifies each case into tp/tn/fp/fn and computes the rates', () => {
    const entries = [
      // tn: consistent case, non-flagging analysis
      {
        case: corpusCase({ id: 'ok', expected: { should_flag: false, notes: '' } }),
        analysis: analysis(),
      },
      // fp: consistent case, but the model flagged material/high
      {
        case: corpusCase({ id: 'benign', expected: { should_flag: false, notes: '' } }),
        analysis: flaggingValueMismatch,
      },
      // tp: seeded value_mismatch, model flagged with the seeded type
      {
        case: corpusCase({
          id: 'seed-hit',
          expected: { should_flag: true, seeded_discrepancy_types: ['value_mismatch'], notes: '' },
        }),
        analysis: flaggingValueMismatch,
      },
      // fn: seeded value_mismatch, model missed it (consistent)
      {
        case: corpusCase({
          id: 'seed-miss',
          expected: { should_flag: true, seeded_discrepancy_types: ['value_mismatch'], notes: '' },
        }),
        analysis: analysis(),
      },
      // tn: vague case, model returned material but LOW confidence → mismatchFlag() null
      {
        case: corpusCase({ id: 'vague', expected: { should_flag: false, notes: '' } }),
        analysis: analysis({ overall_assessment: 'material_discrepancy', confidence: 'low' }),
      },
    ];

    const s = scoreEval(entries);

    expect({ total: s.total, tp: s.tp, tn: s.tn, fp: s.fp, fn: s.fn }).toEqual({
      total: 5,
      tp: 1,
      tn: 2,
      fp: 1,
      fn: 1,
    });
    expect(s.fpRate).toBeCloseTo(1 / 3, 5); // fp / (fp + tn)
    expect(s.fnRate).toBeCloseTo(1 / 2, 5); // fn / (fn + tp)
    expect(s.seededCaughtRate).toBeCloseTo(1 / 2, 5); // seed-hit caught, seed-miss not
    expect(s.passed).toBe(false); // fpRate >= 5% and a seed was missed
    expect(s.cases.find((c) => c.id === 'benign')?.outcome).toBe('fp');
    expect(s.cases.find((c) => c.id === 'seed-hit')?.seededCaught).toBe(true);
    expect(s.cases.find((c) => c.id === 'seed-miss')?.seededCaught).toBe(false);
  });

  it('passes when there are no false positives and every seeded discrepancy is caught', () => {
    const entries = [
      {
        case: corpusCase({ id: 'ok', expected: { should_flag: false, notes: '' } }),
        analysis: analysis(),
      },
      {
        case: corpusCase({
          id: 'seed',
          expected: { should_flag: true, seeded_discrepancy_types: ['value_mismatch'], notes: '' },
        }),
        analysis: flaggingValueMismatch,
      },
    ];
    const s = scoreEval(entries);
    expect(s.fp).toBe(0);
    expect(s.fpRate).toBe(0);
    expect(s.seededCaughtRate).toBe(1);
    expect(s.passed).toBe(true);
  });
});
