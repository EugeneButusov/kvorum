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

  it('exposes the aragon_voting, dual_governance, easy_track, and both reconcile ingesters', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LidoSourceModule],
    }).compile();
    const plugin = moduleRef.get<SourcePlugin>(LIDO_SOURCE_PLUGIN);

    expect(plugin.name).toBe('lido');
    expect(plugin.ingesters.map((i) => i.sourceType).sort()).toEqual([
      'aragon_voting',
      'aragon_voting_reconcile',
      'dual_governance',
      'dual_governance_reconcile',
      'easy_track',
    ]);

    const voting = plugin.ingesters.find((i) => i.sourceType === 'aragon_voting')!;
    expect(voting.supportedChainIds).toEqual(['0x1']);
    expect(voting.buildBackfillRuntime).toBeDefined(); // backfillable

    const dg = plugin.ingesters.find((i) => i.sourceType === 'dual_governance')!;
    expect(dg.supportedChainIds).toEqual(['0x1']);
    expect(dg.buildBackfillRuntime).toBeDefined(); // backfillable

    const easyTrack = plugin.ingesters.find((i) => i.sourceType === 'easy_track')!;
    expect(easyTrack.supportedChainIds).toEqual(['0x1']);
    expect(easyTrack.buildBackfillRuntime).toBeDefined(); // backfillable

    const reconcile = plugin.ingesters.find((i) => i.sourceType === 'aragon_voting_reconcile')!;
    expect(reconcile.supportedChainIds).toEqual(['0x1']);
    expect(reconcile.buildBackfillRuntime).toBeUndefined(); // not backfillable

    const dgReconcile = plugin.ingesters.find((i) => i.sourceType === 'dual_governance_reconcile')!;
    expect(dgReconcile.supportedChainIds).toEqual(['0x1']);
    expect(dgReconcile.buildBackfillRuntime).toBeUndefined(); // not backfillable
  });

  it('registers the Aragon + Dual Governance derivers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LidoSourceModule],
    }).compile();
    const plugin = moduleRef.get<SourcePlugin>(LIDO_SOURCE_PLUGIN);

    // Aragon: actor-address + proposal + vote (3). Dual Governance: actor-address + state + proposal (3).
    expect(plugin.derivers).toHaveLength(6);
    expect(plugin.derivers.map((d) => d.kind).sort()).toEqual([
      'actor-address',
      'actor-address',
      'projection',
      'projection',
      'projection',
      'projection',
    ]);

    const aragon = plugin.derivers.filter((d) => d.sourceTypes.includes('aragon_voting'));
    expect(aragon).toHaveLength(3);

    const dg = plugin.derivers.filter((d) => d.sourceTypes.includes('dual_governance'));
    expect(dg.map((d) => d.kind).sort()).toEqual(['actor-address', 'projection', 'projection']);
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
