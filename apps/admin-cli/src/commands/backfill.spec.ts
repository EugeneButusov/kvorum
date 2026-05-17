import { describe, expect, it, vi } from 'vitest';
import { resolveCompoundBackfillFactory } from './backfill.js';

describe('resolveCompoundBackfillFactory', () => {
  const createCompoundGovernorPlugin = vi.fn();
  const createCompoundGovernorAlphaPlugin = vi.fn();

  it('returns bravo factory for compound_governor', () => {
    const factory = resolveCompoundBackfillFactory('compound_governor', {
      createCompoundGovernorPlugin,
      createCompoundGovernorAlphaPlugin,
    });

    expect(factory).toBe(createCompoundGovernorPlugin);
  });

  it('returns alpha factory for compound_governor_alpha', () => {
    const factory = resolveCompoundBackfillFactory('compound_governor_alpha', {
      createCompoundGovernorPlugin,
      createCompoundGovernorAlphaPlugin,
    });

    expect(factory).toBe(createCompoundGovernorAlphaPlugin);
  });

  it('returns undefined for unknown source types', () => {
    const factory = resolveCompoundBackfillFactory('unknown_source', {
      createCompoundGovernorPlugin,
      createCompoundGovernorAlphaPlugin,
    });

    expect(factory).toBeUndefined();
  });
});
