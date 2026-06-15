import { describe, expect, it, vi } from 'vitest';
import { buildBackfillSourcePlugins, resolvePluginAndConfig } from './backfill-source-plugins.js';

const makeDeps = () => ({
  archiveWriter: {} as never,
  dlqRepo: {} as never,
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
});

describe('buildBackfillSourcePlugins', () => {
  it('bootstraps governor, comp-token, and aave-governor-v2 plugins transparently', () => {
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

  it('includes aave_governor_v2 in the returned source type list and keeps Compound sources unchanged', () => {
    const plugins = buildBackfillSourcePlugins({
      governor: makeDeps(),
      compToken: makeDeps(),
      aaveGovernorV2: makeDeps(),
    });

    const types = plugins.map((p) => p.sourceType);
    expect(types).toContain('aave_governor_v2');
    expect(types).toContain('compound_governor_bravo');
    expect(types).toContain('compound_governor_alpha');
    expect(types).toContain('compound_governor_oz');
    expect(types).toContain('compound_comp_token');
  });
});

describe('resolvePluginAndConfig', () => {
  const plugins = buildBackfillSourcePlugins({
    governor: makeDeps(),
    compToken: makeDeps(),
    aaveGovernorV2: makeDeps(),
  });

  it('resolves aave_governor_v2 to the correct kind and config', () => {
    const resolved = resolvePluginAndConfig(
      'aave_governor_v2',
      { governor_address: '0xec568fffba86c094cf06b22134b23074dfe2252c' },
      plugins,
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.kind).toBe('aave_governor_v2');
    expect(resolved?.parsedConfig).toMatchObject({
      governor_address: '0xec568fffba86c094cf06b22134b23074dfe2252c',
    });
  });

  it('resolves compound_governor_bravo (Compound sources unchanged)', () => {
    const resolved = resolvePluginAndConfig(
      'compound_governor_bravo',
      { governor_address: '0xc0da01a04c3f3e0be433606045bb7017a7323e38', filter_address: null },
      plugins,
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.kind).toBe('governor');
  });

  it('returns null for an unknown source_type', () => {
    expect(resolvePluginAndConfig('unknown_source' as never, {}, plugins)).toBeNull();
  });
});
