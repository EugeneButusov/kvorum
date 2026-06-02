import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourcePlugin } from '@sources/core';
import { AAVE_SOURCE_PLUGIN, AaveSourceModule } from './aave.module';

vi.mock('@libs/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libs/db')>();
  return {
    ...actual,
    pgDb: {},
    chDb: {},
    ArchiveEventRepository: class {
      public find = vi.fn();
      public insert = vi.fn();
      constructor(_db: unknown) {}
    },
    DlqRepository: class {
      public insert = vi.fn();
      constructor(_db: unknown) {}
    },
  };
});

describe('AaveSourceModule', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('compiles the testing module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AaveSourceModule],
    }).compile();

    expect(moduleRef).toBeDefined();
  });

  it('resolves AAVE_SOURCE_PLUGIN with the Aave derivers registered', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AaveSourceModule],
    }).compile();
    const plugin = moduleRef.get<SourcePlugin>(AAVE_SOURCE_PLUGIN);

    expect(plugin.name).toBe('aave');
    expect(plugin.ingesters).toHaveLength(2);
    expect(plugin.ingesters.map((ingester) => ingester.sourceType).sort()).toEqual([
      'aave_governance_v3',
      'aave_governance_v3_reconcile',
    ]);
    expect(plugin.derivers).toHaveLength(2);
    expect(plugin.derivers.map((deriver) => deriver.kind).sort()).toEqual([
      'actor-address',
      'projection',
    ]);
    expect(plugin.snapshotStrategies).toEqual([]);
  });
});
