import { describe, expect, it } from 'vitest';
import { assembleTallySummary, assembleTally, extractChoiceScores } from './proposal-tally';

describe('assembleTally — from votes', () => {
  it('sums per choice and derives exact percentages', () => {
    const out = assembleTally({
      declaredChoices: [0, 1, 2],
      aggregate: [
        { primary_choice: 0, voting_power: '300', voter_count: 2 },
        { primary_choice: 1, voting_power: '100', voter_count: 1 },
      ],
      choiceScores: null,
    });

    expect(out.source).toBe('votes');
    expect(out.total_voting_power).toBe('400');
    expect(out.total_voters).toBe(3);
    expect(out.choices).toEqual([
      { choice_index: 0, voting_power: '300', voter_count: 2, pct: 75 },
      { choice_index: 1, voting_power: '100', voter_count: 1, pct: 25 },
      { choice_index: 2, voting_power: '0', voter_count: 0, pct: 0 }, // declared, no votes
    ]);
  });

  it('keeps UInt256 power exact beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = '12345678901234567890123456789';
    const out = assembleTally({
      declaredChoices: [0, 1],
      aggregate: [
        { primary_choice: 0, voting_power: huge, voter_count: 1 },
        { primary_choice: 1, voting_power: huge, voter_count: 1 },
      ],
      choiceScores: null,
    });
    expect(out.total_voting_power).toBe((BigInt(huge) * 2n).toString());
    expect(out.choices.map((c) => c.pct)).toEqual([50, 50]);
  });

  it('treats a negative or non-integer power string as zero', () => {
    const out = assembleTally({
      declaredChoices: [0, 1],
      aggregate: [
        { primary_choice: 0, voting_power: '100', voter_count: 1 },
        { primary_choice: 1, voting_power: '-5', voter_count: 1 },
      ],
      choiceScores: null,
    });
    expect(out.choices[0]!.pct).toBe(100);
    expect(out.choices[1]!.voting_power).toBe('0');
  });

  it('surfaces a choice seen only in votes even if not declared', () => {
    const out = assembleTally({
      declaredChoices: [0],
      aggregate: [{ primary_choice: 3, voting_power: '10', voter_count: 1 }],
      choiceScores: null,
    });
    expect(out.choices.map((c) => c.choice_index)).toEqual([0, 3]);
  });

  it('is zero-safe with no votes', () => {
    const out = assembleTally({ declaredChoices: [0, 1], aggregate: [], choiceScores: null });
    expect(out.total_voting_power).toBe('0');
    expect(out.total_voters).toBe(0);
    expect(out.choices.every((c) => c.pct === 0)).toBe(true);
  });
});

describe('assembleTally — from choice_scores', () => {
  it('uses the pre-summed scores and keeps voter counts from the votes', () => {
    const out = assembleTally({
      declaredChoices: [0, 1],
      aggregate: [
        { primary_choice: 0, voting_power: '1', voter_count: 4 },
        { primary_choice: 1, voting_power: '1', voter_count: 6 },
      ],
      choiceScores: [100, 300],
    });

    expect(out.source).toBe('choice_scores');
    expect(out.total_voting_power).toBe('400');
    expect(out.total_voters).toBe(10);
    expect(out.choices).toEqual([
      { choice_index: 0, voting_power: '100', voter_count: 4, pct: 25 },
      { choice_index: 1, voting_power: '300', voter_count: 6, pct: 75 },
    ]);
  });
});

describe('extractChoiceScores', () => {
  it('returns the array for metadata carrying non-empty choice_scores', () => {
    expect(extractChoiceScores({ kind: 'snapshot', choice_scores: [1, 2] })).toEqual([1, 2]);
  });
  it('returns null for empty, absent, or non-array choice_scores', () => {
    expect(extractChoiceScores({ kind: 'snapshot', choice_scores: [] })).toBeNull();
    expect(extractChoiceScores({ kind: 'snapshot', choice_scores: null })).toBeNull();
    expect(extractChoiceScores({ kind: 'aragon_voting' })).toBeNull();
    expect(extractChoiceScores(null)).toBeNull();
  });
});

describe('assembleTallySummary', () => {
  const choices = [
    { proposal_id: 'p1', choice_index: 0, value: 'for' },
    { proposal_id: 'p1', choice_index: 1, value: 'against' },
    { proposal_id: 'p1', choice_index: 2, value: 'abstain' },
  ];

  it('labels each choice and carries the exact percentage', () => {
    const out = assembleTallySummary({
      declaredChoices: choices,
      aggregate: [
        { primary_choice: 0, voting_power: '780', voter_count: 12 },
        { primary_choice: 1, voting_power: '190', voter_count: 4 },
        { primary_choice: 2, voting_power: '30', voter_count: 1 },
      ],
    });

    expect(out).toEqual([
      { choice_index: 0, label: 'for', pct: 78 },
      { choice_index: 1, label: 'against', pct: 19 },
      { choice_index: 2, label: 'abstain', pct: 3 },
    ]);
  });

  it('returns null when no votes are cast, so the row draws no bars', () => {
    expect(assembleTallySummary({ declaredChoices: choices, aggregate: [] })).toBeNull();
  });

  it('surfaces a declared choice that received no votes at 0%', () => {
    const out = assembleTallySummary({
      declaredChoices: choices,
      aggregate: [{ primary_choice: 0, voting_power: '100', voter_count: 1 }],
    });

    expect(out).toEqual([
      { choice_index: 0, label: 'for', pct: 100 },
      { choice_index: 1, label: 'against', pct: 0 },
      { choice_index: 2, label: 'abstain', pct: 0 },
    ]);
  });

  it('falls back to a positional label for a choice the proposal never declared', () => {
    const out = assembleTallySummary({
      declaredChoices: [],
      aggregate: [{ primary_choice: 3, voting_power: '100', voter_count: 1 }],
    });

    expect(out).toEqual([{ choice_index: 3, label: 'Choice 4', pct: 100 }]);
  });
});
