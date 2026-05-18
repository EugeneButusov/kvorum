import { describe, expect, it, vi } from 'vitest';
import { resolveBackfillSourcePlugin } from '../plugins/backfill-source-plugins.js';

describe('resolveBackfillSourcePlugin', () => {
  const bravoPlugin = {
    sourceType: 'compound_governor_bravo',
    parseConfig: vi.fn(),
    buildIngestSpec: vi.fn(),
  };
  const alphaPlugin = {
    sourceType: 'compound_governor_alpha',
    parseConfig: vi.fn(),
    buildIngestSpec: vi.fn(),
  };

  it('returns bravo plugin for compound_governor_bravo', () => {
    const plugin = resolveBackfillSourcePlugin('compound_governor_bravo', [
      bravoPlugin,
      alphaPlugin,
    ]);

    expect(plugin).toBe(bravoPlugin);
  });

  it('returns alpha plugin for compound_governor_alpha', () => {
    const plugin = resolveBackfillSourcePlugin('compound_governor_alpha', [
      bravoPlugin,
      alphaPlugin,
    ]);

    expect(plugin).toBe(alphaPlugin);
  });

  it('returns undefined for unknown source types', () => {
    const plugin = resolveBackfillSourcePlugin('unknown_source', [bravoPlugin, alphaPlugin]);

    expect(plugin).toBeUndefined();
  });
});
