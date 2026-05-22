import { describe, expect, it, vi } from 'vitest';
import { buildBackfillSourcePlugins } from './backfill-source-plugins.js';

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
});
