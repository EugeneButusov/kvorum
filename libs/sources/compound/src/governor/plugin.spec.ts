import { describe, it, expect, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { ArchiveWriter } from './archive-writer';
import { createCompoundGovernorPlugin } from './plugin';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_governor',
  chainId: 1,
  sourceLabel: 'compound_governor',
};

const mockArchiveWriter = {} as ArchiveWriter;
const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createCompoundGovernorPlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createCompoundGovernorPlugin', () => {
  it('#1 — sourceType is compound_governor', () => {
    expect(makePlugin().sourceType).toBe('compound_governor');
  });

  describe('parseConfig', () => {
    it('#2 — accepts a valid governor_address', () => {
      const cfg = makePlugin().parseConfig({
        governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
      });
      expect(cfg.governor_address).toBe('0xc0Da02939E1441F497fd74F78cE7Decb17B66529');
    });

    it('#3 — rejects malformed governor_address', () => {
      expect(() => makePlugin().parseConfig({ governor_address: 'not-an-address' })).toThrow();
    });

    it('#4 — rejects missing governor_address', () => {
      expect(() => makePlugin().parseConfig({})).toThrow();
    });
  });

  describe('buildIngestSpec', () => {
    it('#5 — kind is evm-event-poller', () => {
      const cfg = makePlugin().parseConfig({
        governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
      });
      const spec = makePlugin().buildIngestSpec(CTX, cfg);
      expect(spec.kind).toBe('evm-event-poller');
    });

    it('#6 — filter.address is lowercased', () => {
      const plugin = makePlugin();
      const cfg = plugin.parseConfig({
        governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
      });
      const spec = plugin.buildIngestSpec(CTX, cfg);
      expect(spec.filter.address).toBe('0xc0da02939e1441f497fd74f78ce7decb17b66529');
    });

    it('#7 — filter.topics is single nested array with 4 topics', () => {
      const plugin = makePlugin();
      const cfg = plugin.parseConfig({
        governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
      });
      const spec = plugin.buildIngestSpec(CTX, cfg);
      expect(spec.filter.topics).toHaveLength(1);
      expect(spec.filter.topics![0]).toHaveLength(4);
    });

    it('#8 — listener is a function', () => {
      const plugin = makePlugin();
      const cfg = plugin.parseConfig({
        governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
      });
      const spec = plugin.buildIngestSpec(CTX, cfg);
      expect(typeof spec.listener).toBe('function');
    });
  });
});
