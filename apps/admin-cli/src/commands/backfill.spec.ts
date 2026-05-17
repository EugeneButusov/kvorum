import { describe, expect, it, vi } from 'vitest';
import { resolveCompoundBackfillPlugin } from './backfill.js';

describe('resolveCompoundBackfillPlugin', () => {
  const bravoPlugin = {
    sourceType: 'compound_governor',
    parseConfig: vi.fn(),
    buildIngestSpec: vi.fn(),
  };
  const alphaPlugin = {
    sourceType: 'compound_governor_alpha',
    parseConfig: vi.fn(),
    buildIngestSpec: vi.fn(),
  };

  it('returns bravo plugin for compound_governor', () => {
    const plugin = resolveCompoundBackfillPlugin('compound_governor', [bravoPlugin, alphaPlugin]);

    expect(plugin).toBe(bravoPlugin);
  });

  it('returns alpha plugin for compound_governor_alpha', () => {
    const plugin = resolveCompoundBackfillPlugin('compound_governor_alpha', [
      bravoPlugin,
      alphaPlugin,
    ]);

    expect(plugin).toBe(alphaPlugin);
  });

  it('returns undefined for unknown source types', () => {
    const plugin = resolveCompoundBackfillPlugin('unknown_source', [bravoPlugin, alphaPlugin]);

    expect(plugin).toBeUndefined();
  });
});
