import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COMP_TOKEN_ADDRESS } from '@sources/compound';
import type { SourcePlugin } from '@sources/core';
import { COMPOUND_SOURCE_PLUGIN, CompoundSourceModule } from './compound.module';

vi.mock('@libs/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libs/db')>();
  return {
    ...actual,
    pgDb: {},
    chDb: {},
    ActorRepository: class {
      constructor(_db: unknown) {}
    },
    ArchiveEventRepository: class {
      public find = vi.fn();
      public insert = vi.fn();
      constructor(_db: unknown) {}
    },
    DaoSourceRepository: class {
      constructor(_db: unknown) {}
    },
    DelegationFlowProjectionWriter: class {
      constructor(_db: unknown) {}
    },
    DlqRepository: class {
      public insert = vi.fn();
      constructor(_db: unknown) {}
    },
    ArchiveDerivationRepository: class {
      constructor(_db: unknown) {}
    },
    VoteEventsProjectionWriter: class {
      constructor(_db: unknown) {}
    },
    VoteEventsProjectionReadRepository: class {
      constructor(_db: unknown) {}
    },
  };
});

describe('CompoundSourceModule', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('M1 compiles testing module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CompoundSourceModule],
    }).compile();
    expect(moduleRef).toBeDefined();
  });

  it('M2/M3/M4 exposes expected plugins including compound_comp_token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CompoundSourceModule],
    }).compile();
    const plugin = moduleRef.get<SourcePlugin>(COMPOUND_SOURCE_PLUGIN);

    expect(plugin.ingesters).toHaveLength(7);
    expect(plugin.ingesters.map((p) => p.sourceType).sort()).toEqual([
      'compound_comp_token',
      'compound_governor_alpha',
      'compound_governor_alpha_reconcile',
      'compound_governor_bravo',
      'compound_governor_bravo_reconcile',
      'compound_governor_oz',
      'compound_governor_oz_reconcile',
    ]);

    const compTokenPlugins = plugin.ingesters.filter((p) => p.sourceType === 'compound_comp_token');
    expect(compTokenPlugins).toHaveLength(1);
    expect(compTokenPlugins[0]!.supportedChainIds).toEqual(['0x1']);
    expect(() =>
      compTokenPlugins[0]!.parseConfig({ token_address: COMP_TOKEN_ADDRESS }),
    ).not.toThrow();
    expect(() => compTokenPlugins[0]!.parseConfig({ token_address: 'not-an-address' })).toThrow();
    expect(plugin.derivers.map((d) => d.kind).sort()).toEqual([
      'actor-address',
      'projection',
      'projection',
      'projection',
    ]);

    expect(plugin.readExtension.sourceTypes).toContain('compound_governor_bravo');
    expect(plugin.readExtension.delegationModel('compound_governor_bravo')).toBe('power-bearing');
  });

  it('M5 logs comp-token registration exactly once', async () => {
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await Test.createTestingModule({
      imports: [CompoundSourceModule],
    }).compile();

    const count = spy.mock.calls.filter(
      (c) => c[0] === 'compound_comp_token plugin registered',
    ).length;
    expect(count).toBe(1);
  });

  it('M6 negative control: overridden plugin provider does not emit comp-token registration log', async () => {
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await Test.createTestingModule({
      imports: [CompoundSourceModule],
    })
      .overrideProvider(COMPOUND_SOURCE_PLUGIN)
      .useValue({
        name: 'noop',
        ingesters: [],
        derivers: [],
        readExtension: {
          sourceTypes: [],
          choiceBounds: () => ({ min: 0, max: 2 }),
          delegationModel: () => 'power-bearing' as const,
          getProposalExtension: () => Promise.resolve(null),
        },
      })
      .compile();

    const count = spy.mock.calls.filter(
      (c) => c[0] === 'compound_comp_token plugin registered',
    ).length;
    expect(count).toBe(0);
  });
});
