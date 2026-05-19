import { describe, expect, it, vi } from 'vitest';
import { resolveBackfillSourcePlugin } from '../plugins/backfill-source-plugins.js';

describe('resolveBackfillSourcePlugin', () => {
  const bravoPlugin = {
    sourceType: 'compound_governor_bravo',
    parseConfig: vi.fn(),
    buildBackfillRuntime: vi.fn(),
    buildIngestSpec: vi.fn(),
  };
  const alphaPlugin = {
    sourceType: 'compound_governor_alpha',
    parseConfig: vi.fn(),
    buildBackfillRuntime: vi.fn(),
    buildIngestSpec: vi.fn(),
  };
  const ozPlugin = {
    sourceType: 'compound_governor_oz',
    parseConfig: vi.fn(),
    buildBackfillRuntime: vi.fn(),
    buildIngestSpec: vi.fn(),
  };

  it('returns bravo plugin for compound_governor_bravo', () => {
    const plugin = resolveBackfillSourcePlugin('compound_governor_bravo', [
      bravoPlugin,
      alphaPlugin,
      ozPlugin,
    ]);

    expect(plugin).toBe(bravoPlugin);
  });

  it('returns alpha plugin for compound_governor_alpha', () => {
    const plugin = resolveBackfillSourcePlugin('compound_governor_alpha', [
      bravoPlugin,
      alphaPlugin,
      ozPlugin,
    ]);

    expect(plugin).toBe(alphaPlugin);
  });

  it('returns undefined for unknown source types', () => {
    const plugin = resolveBackfillSourcePlugin('unknown_source', [
      bravoPlugin,
      alphaPlugin,
      ozPlugin,
    ]);

    expect(plugin).toBeUndefined();
  });

  it('returns oz plugin for compound_governor_oz', () => {
    const plugin = resolveBackfillSourcePlugin('compound_governor_oz', [
      bravoPlugin,
      alphaPlugin,
      ozPlugin,
    ]);

    expect(plugin).toBe(ozPlugin);
  });
});
