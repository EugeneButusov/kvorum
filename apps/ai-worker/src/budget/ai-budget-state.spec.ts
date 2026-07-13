import { describe, expect, it } from 'vitest';
import { AiBudgetState } from './ai-budget-state';

describe('AiBudgetState', () => {
  it('defaults to not-disabled for an uncomputed feature (fail-open)', () => {
    const state = new AiBudgetState();
    expect(state.isDisabled('proposal_summarizer')).toBe(false);
    expect(state.get('proposal_summarizer')).toBeUndefined();
  });

  it('stores and reflects a feature budget', () => {
    const state = new AiBudgetState();
    state.set('mismatch_detector', {
      spendUsd: 21,
      capUsd: 20,
      utilizationPct: 105,
      disabled: true,
    });
    expect(state.isDisabled('mismatch_detector')).toBe(true);
    expect(state.get('mismatch_detector')?.spendUsd).toBe(21);
  });

  it('snapshot returns a detached copy', () => {
    const state = new AiBudgetState();
    state.set('embedding', { spendUsd: 0, capUsd: 1, utilizationPct: 0, disabled: false });
    const snap = state.snapshot();
    state.set('embedding', { spendUsd: 2, capUsd: 1, utilizationPct: 200, disabled: true });
    expect(snap.get('embedding')?.disabled).toBe(false); // snapshot unaffected by later set
  });
});
