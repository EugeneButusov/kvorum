import { Test } from '@nestjs/testing';
import { describe, it, expect, vi } from 'vitest';
import type { SourcePlugin } from '@sources/core';
import { SNAPSHOT_SOURCE_PLUGIN, SnapshotSourceModule } from './snapshot.module';

vi.mock('@libs/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libs/db')>();
  return { ...actual, chDb: {} };
});

describe('SnapshotSourceModule', () => {
  it('compiles and exposes the snapshot plugin', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SnapshotSourceModule] }).compile();
    const plugin = moduleRef.get<SourcePlugin>(SNAPSHOT_SOURCE_PLUGIN);

    expect(plugin.name).toBe('snapshot');
    // off-chain poll ingester + the two on-chain delegation registries (Delegate Registry + Split).
    expect(plugin.ingesters.map((i) => i.sourceType)).toEqual([
      'snapshot',
      'snapshot_delegate_registry',
      'snapshot_split_delegation',
    ]);
    expect(plugin.ingesters[0]!.supportedChainIds).toEqual(['off-chain']);
    expect(plugin.ingesters[1]!.supportedChainIds).toEqual(['0x1']);
    // off-chain: proposal projection applier + actor deriver + vote applier; on-chain: a projection
    // + actor-address deriver per delegation system.
    expect(plugin.derivers.map((d) => d.kind).sort()).toEqual([
      'actor-address',
      'actor-address',
      'offchain-actor-address',
      'offchain-projection',
      'offchain-projection',
      'projection',
      'projection',
    ]);
    // each on-chain system contributes a projection applier + an actor-address deriver.
    expect(plugin.derivers.filter((d) => d.eventTypes.includes('SetDelegate'))).toHaveLength(2);
    expect(plugin.derivers.filter((d) => d.eventTypes.includes('DelegationUpdated'))).toHaveLength(
      2,
    );
    expect(plugin.readExtension.sourceTypes).toEqual([
      'snapshot',
      'snapshot_delegate_registry',
      'snapshot_split_delegation',
    ]);
  });
});
