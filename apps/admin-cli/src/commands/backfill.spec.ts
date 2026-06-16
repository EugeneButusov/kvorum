import { describe, expect, it, vi } from 'vitest';
import { buildBackfillSourcePlugins } from '../plugins/backfill-source-plugins.js';

const makeDeps = () => ({
  archiveWriter: {} as never,
  dlqRepo: {} as never,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});

describe('backfill command plugin coverage', () => {
  it('exposes all known source types, including comp-token and aave-governor-v2', () => {
    const plugins = buildBackfillSourcePlugins({
      governor: makeDeps(),
      compToken: makeDeps(),
      aaveGovernorV2: makeDeps(),
    });

    expect(plugins.map((plugin) => plugin.sourceType)).toEqual([
      'compound_governor_bravo',
      'compound_governor_alpha',
      'compound_governor_oz',
      'compound_comp_token',
      'aave_governor_v2',
    ]);
  });
});
