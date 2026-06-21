import { Test } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SourcePlugin } from '@sources/core';
import { LIDO_SOURCE_PLUGIN, LidoSourceModule } from './lido.module';

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

describe('LidoSourceModule', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('M1 compiles the testing module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LidoSourceModule],
    }).compile();
    expect(moduleRef).toBeDefined();
  });

  it('M2 exposes exactly one ingester with sourceType aragon_voting', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LidoSourceModule],
    }).compile();
    const plugin = moduleRef.get<SourcePlugin>(LIDO_SOURCE_PLUGIN);

    expect(plugin.name).toBe('lido');
    expect(plugin.ingesters).toHaveLength(1);
    expect(plugin.ingesters[0]!.sourceType).toBe('aragon_voting');
    expect(plugin.ingesters[0]!.supportedChainIds).toEqual(['0x1']);
    expect(plugin.ingesters[0]!.capabilities).toContain('backfillable');
  });

  it('M3 has empty derivers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LidoSourceModule],
    }).compile();
    const plugin = moduleRef.get<SourcePlugin>(LIDO_SOURCE_PLUGIN);
    expect(plugin.derivers).toHaveLength(0);
  });

  it('M4 readExtension claims aragon_voting and returns expected stubs', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LidoSourceModule],
    }).compile();
    const plugin = moduleRef.get<SourcePlugin>(LIDO_SOURCE_PLUGIN);

    expect(plugin.readExtension.sourceTypes).toContain('aragon_voting');
    expect(plugin.readExtension.choiceBounds('aragon_voting')).toEqual({ min: 0, max: 1 });
    expect(plugin.readExtension.delegationModel('aragon_voting')).toBe('relationship-only');
    await expect(
      plugin.readExtension.getProposalExtension('prop-1', 'aragon_voting'),
    ).resolves.toBeNull();
  });
});
