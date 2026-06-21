import { describe, expect, it } from 'vitest';
import { singleChoiceBreakdown } from './breakdown';

describe('singleChoiceBreakdown', () => {
  it('produces a one-element JSON array with weight 1.0', () => {
    const result = JSON.parse(singleChoiceBreakdown(2)) as unknown[];
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ choice_index: 2, weight: '1.0' });
  });

  it('preserves choice_index as the primary_choice value', () => {
    for (const idx of [0, 1, 2]) {
      const parsed = JSON.parse(singleChoiceBreakdown(idx)) as Array<{ choice_index: number }>;
      expect(parsed[0]?.choice_index).toBe(idx);
    }
  });
});
