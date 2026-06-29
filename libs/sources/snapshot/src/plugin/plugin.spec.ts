import type { Kysely } from 'kysely';
import { describe, it, expect } from 'vitest';
import type { ClickHouseDatabase } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { createSnapshotPlugin } from './plugin';
import { SnapshotClient } from '../client/client';

const deps = () => ({
  client: new SnapshotClient(),
  chDb: {} as unknown as Kysely<ClickHouseDatabase>,
});

const ctx: SourceContext = {
  daoSourceId: 'src-1',
  sourceType: 'snapshot',
  chainId: 'off-chain',
  sourceLabel: 'snapshot',
};

describe('createSnapshotPlugin', () => {
  it('declares the off-chain snapshot source', () => {
    const p = createSnapshotPlugin(deps());
    expect(p.sourceType).toBe('snapshot');
    expect(p.supportedChainIds).toEqual(['off-chain']);
  });

  it('parses a { space } config and rejects an empty one', () => {
    const p = createSnapshotPlugin(deps());
    expect(p.parseConfig({ space: 'lido-snapshot.eth' })).toEqual({ space: 'lido-snapshot.eth' });
    expect(() => p.parseConfig({ space: '' })).toThrow();
    expect(() => p.parseConfig({})).toThrow();
  });

  it('builds a poll IngestSpec with a listener and the default interval', () => {
    const p = createSnapshotPlugin(deps());
    const spec = p.buildIngestSpec(ctx, { space: 'lido-snapshot.eth' });
    expect(spec.kind).toBe('poll');
    if (spec.kind !== 'poll') throw new Error('expected poll spec');
    expect(spec.listener.intervalMs).toBe(60_000);
    expect(typeof spec.listener.poll).toBe('function');
  });

  it('honours a custom interval', () => {
    const p = createSnapshotPlugin({ ...deps(), intervalMs: 30_000 });
    const spec = p.buildIngestSpec(ctx, { space: 's' });
    if (spec.kind !== 'poll') throw new Error('expected poll spec');
    expect(spec.listener.intervalMs).toBe(30_000);
  });

  it('exposes an off-chain archive writer but no EVM backfill/archive consumer', () => {
    const p = createSnapshotPlugin(deps());
    expect(p.buildOffChainArchiveWriter).toBeDefined();
    expect(typeof p.buildOffChainArchiveWriter!()).toBe('function');
    expect(p.buildBackfillRuntime).toBeUndefined();
    expect(p.buildArchiveConsumer).toBeUndefined();
  });
});
