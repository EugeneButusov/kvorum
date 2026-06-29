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
    expect(plugin.ingesters).toHaveLength(1);
    expect(plugin.ingesters[0]!.sourceType).toBe('snapshot');
    expect(plugin.ingesters[0]!.supportedChainIds).toEqual(['off-chain']);
    expect(plugin.derivers).toEqual([]);
    expect(plugin.readExtension.sourceTypes).toEqual(['snapshot']);
  });
});
