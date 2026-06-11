import { describe, expect, it, vi } from 'vitest';
import { buildBackfillSourcePlugins, buildSnapshotStrategyMap } from './backfill-source-plugins.js';

describe('buildBackfillSourcePlugins', () => {
  it('bootstraps governor and comp-token plugins transparently', () => {
    const plugins = buildBackfillSourcePlugins({
      governor: {
        archiveWriter: {} as never,
        dlqRepo: {} as never,
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      },
      compToken: {
        archiveWriter: {} as never,
        dlqRepo: {} as never,
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      },
    });

    expect(plugins.map((plugin) => plugin.sourceType)).toEqual([
      'compound_governor_bravo',
      'compound_governor_alpha',
      'compound_governor_oz',
      'compound_comp_token',
    ]);
  });

  it('builds source-agnostic snapshot strategy map for compound governor source types', () => {
    const map = buildSnapshotStrategyMap();

    expect([...map.keys()].sort()).toEqual([
      'compound_governor_alpha',
      'compound_governor_bravo',
      'compound_governor_oz',
    ]);
    expect(map.get('compound_governor_alpha')).toBe(map.get('compound_governor_bravo'));
    expect(map.get('compound_governor_bravo')).toBe(map.get('compound_governor_oz'));
  });
});
