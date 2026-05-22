import { describe, expect, it, vi } from 'vitest';
import { buildBackfillSourcePlugins } from '../plugins/backfill-source-plugins.js';

describe('backfill command plugin coverage', () => {
  it('exposes all known source types, including comp-token', () => {
    const plugins = buildBackfillSourcePlugins({
      governor: {
        archiveWriter: {} as never,
        dlqRepo: {} as never,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
      compToken: {
        archiveWriter: {} as never,
        dlqRepo: {} as never,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    });

    expect(plugins.map((plugin) => plugin.sourceType)).toEqual([
      'compound_governor_bravo',
      'compound_governor_alpha',
      'compound_governor_oz',
      'compound_comp_token',
    ]);
  });
});
