import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { ClickHouseDatabase } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { createForumPlugin, DEFAULT_FORUM_POLL_INTERVAL_MS } from './plugin';

const chDb = {} as unknown as Kysely<ClickHouseDatabase>;
const ctx = {} as SourceContext;

describe('createForumPlugin', () => {
  it('describes the off-chain discourse_forum ingester', () => {
    const ingester = createForumPlugin({ chDb });
    expect(ingester.sourceType).toBe('discourse_forum');
    expect(ingester.supportedChainIds).toEqual(['off-chain']);
    expect(typeof ingester.buildOffChainArchiveWriter).toBe('function');
  });

  it('parses the {host, categories} config', () => {
    const ingester = createForumPlugin({ chDb });
    expect(ingester.parseConfig({ host: 'research.lido.fi', categories: ['proposals'] })).toEqual({
      host: 'research.lido.fi',
      categories: ['proposals'],
    });
    expect(() => ingester.parseConfig({ host: 'h' })).toThrow();
  });

  it('builds a poll ingest spec whose listener carries the configured interval', () => {
    const ingester = createForumPlugin({ chDb, intervalMs: 12_345 });
    const spec = ingester.buildIngestSpec(ctx, {
      host: 'research.lido.fi',
      categories: ['proposals'],
    });
    expect(spec.kind).toBe('poll');
    if (spec.kind !== 'poll') throw new Error('expected poll spec');
    expect(spec.listener.intervalMs).toBe(12_345);
  });

  it('defaults the poll interval', () => {
    const spec = createForumPlugin({ chDb }).buildIngestSpec(ctx, {
      host: 'h',
      categories: ['c'],
    });
    if (spec.kind !== 'poll') throw new Error('expected poll spec');
    expect(spec.listener.intervalMs).toBe(DEFAULT_FORUM_POLL_INTERVAL_MS);
  });
});
