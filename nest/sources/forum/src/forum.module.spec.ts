import { Test } from '@nestjs/testing';
import { describe, it, expect, vi } from 'vitest';
import type { SourcePlugin } from '@sources/core';
import { FORUM_SOURCE_PLUGIN, ForumSourceModule } from './forum.module';

vi.mock('@libs/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libs/db')>();
  return { ...actual, chDb: {} };
});

describe('ForumSourceModule', () => {
  it('compiles and exposes the forum plugin', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ForumSourceModule] }).compile();
    const plugin = moduleRef.get<SourcePlugin>(FORUM_SOURCE_PLUGIN);

    expect(plugin.name).toBe('forum');
    expect(plugin.ingesters.map((i) => i.sourceType)).toEqual(['discourse_forum']);
    expect(plugin.ingesters[0]!.supportedChainIds).toEqual(['off-chain']);
    // Thread projection applier + the no-op actor-address deriver that unblocks the gate.
    expect(plugin.derivers.map((d) => d.kind).sort()).toEqual([
      'offchain-actor-address',
      'offchain-projection',
    ]);
    expect(plugin.readExtension.sourceTypes).toEqual(['discourse_forum']);
  });
});
