import { describe, expect, it } from 'vitest';
import type { ProposalAction } from '@libs/db';
import { MISMATCH_CORPUS, type DiscrepancyType } from './mismatch-corpus.js';
import { serializeDecodedActions } from '../schemas/proposal-summary-input.js';

const ALL_DISCREPANCY_TYPES: DiscrepancyType[] = [
  'value_mismatch',
  'omitted_in_description',
  'extra_in_description',
  'misleading_phrasing',
  'target_mismatch',
];

describe('MISMATCH_CORPUS', () => {
  it('has a corpus of roughly 20 labeled cases with unique ids', () => {
    expect(MISMATCH_CORPUS.length).toBeGreaterThanOrEqual(15);
    const ids = MISMATCH_CORPUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every case has a description and at least one decoded action that serializes', () => {
    for (const c of MISMATCH_CORPUS) {
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.decoded_actions.length).toBeGreaterThan(0);
      expect(() =>
        serializeDecodedActions(c.decoded_actions as unknown as ProposalAction[]),
      ).not.toThrow();
    }
  });

  it('seeded discrepancy cases flag and carry types; consistent cases carry none', () => {
    for (const c of MISMATCH_CORPUS) {
      const seeds = c.expected.seeded_discrepancy_types ?? [];
      if (seeds.length > 0) {
        expect(c.expected.should_flag).toBe(true); // a seeded discrepancy must be surfaceable
      } else {
        expect(c.expected.should_flag).toBe(false); // no seed ⇒ should not flag
      }
    }
  });

  it('covers every discrepancy type across the seeded cases', () => {
    const covered = new Set(
      MISMATCH_CORPUS.flatMap((c) => c.expected.seeded_discrepancy_types ?? []),
    );
    for (const type of ALL_DISCREPANCY_TYPES) {
      expect(covered.has(type)).toBe(true);
    }
  });

  it('includes both should-flag and should-not-flag cases', () => {
    expect(MISMATCH_CORPUS.some((c) => c.expected.should_flag)).toBe(true);
    expect(MISMATCH_CORPUS.some((c) => !c.expected.should_flag)).toBe(true);
  });
});
