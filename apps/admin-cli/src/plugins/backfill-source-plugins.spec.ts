import { describe, expect, it, vi } from 'vitest';
import { buildBackfillSourcePlugins } from './backfill-source-plugins.js';

describe('buildBackfillSourcePlugins', () => {
  it('bootstraps compound bravo and alpha plugins transparently', () => {
    const plugins = buildBackfillSourcePlugins({
      archiveWriter: {} as never,
      dlqRepo: {} as never,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(plugins.map((plugin) => plugin.sourceType)).toEqual([
      'compound_governor',
      'compound_governor_alpha',
    ]);
  });
});
