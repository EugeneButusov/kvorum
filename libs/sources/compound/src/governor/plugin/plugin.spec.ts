import { describe, it, expect, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import {
  createCompoundGovernorAlphaPlugin,
  createCompoundGovernorBravoPlugin,
  createCompoundGovernorOzPlugin,
  createCompoundPlugins,
} from './plugin';
import { ArchiveWriter } from '../ingestion/archive-writer';
import * as ingesterListener from '../ingestion/ingester-listener';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_governor_bravo',
  chainId: 1,
  sourceLabel: 'compound_governor_bravo',
};

const ALPHA_CTX: SourceContext = {
  ...CTX,
  sourceType: 'compound_governor_alpha',
  sourceLabel: 'compound_governor_alpha',
};

const OZ_CTX: SourceContext = {
  ...CTX,
  sourceType: 'compound_governor_oz',
  sourceLabel: 'compound_governor_oz',
};

const mockArchiveWriter = {} as ArchiveWriter;
const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createCompoundGovernorBravoPlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

function makeAlphaPlugin() {
  return createCompoundGovernorAlphaPlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

function makeOzPlugin() {
  return createCompoundGovernorOzPlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createCompoundGovernorBravoPlugin', () => {
  it('#1 — sourceType is compound_governor_bravo', () => {
    expect(makePlugin().sourceType).toBe('compound_governor_bravo');
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

    it('#7 — filter.topics is single nested array with 5 topics', () => {
      const plugin = makePlugin();
      const cfg = plugin.parseConfig({
        governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
      });
      const spec = plugin.buildIngestSpec(CTX, cfg);
      expect(spec.filter.topics).toHaveLength(1);
      expect(spec.filter.topics![0]).toHaveLength(5);
    });

    it('#8 — listener is a function', () => {
      const plugin = makePlugin();
      const cfg = plugin.parseConfig({
        governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
      });
      const spec = plugin.buildIngestSpec(CTX, cfg);
      expect(typeof spec.listener).toBe('function');
    });

    it('#8.1 — listener is built with onWriteFailure=throw', () => {
      const spy = vi.spyOn(ingesterListener, 'makeIngesterListener');
      const plugin = makePlugin();
      const cfg = plugin.parseConfig({
        governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
      });
      plugin.buildIngestSpec(CTX, cfg);

      expect(spy).toHaveBeenCalledWith(expect.any(Object), { onWriteFailure: 'throw' });
    });
  });

  it('#8.2 — buildBackfillRuntime returns evm log filter + listenerFactory', () => {
    const plugin = makePlugin();
    const cfg = plugin.parseConfig({
      governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
    });
    const runtime = plugin.buildBackfillRuntime(CTX, cfg);

    expect(runtime.filter.address).toBe('0xc0da02939e1441f497fd74f78ce7decb17b66529');
    expect(typeof runtime.listenerFactory).toBe('function');
  });
});

describe('createCompoundGovernorAlphaPlugin', () => {
  it('#9 — sourceType is compound_governor_alpha', () => {
    expect(makeAlphaPlugin().sourceType).toBe('compound_governor_alpha');
  });

  describe('parseConfig', () => {
    it('#10 — accepts a valid governor_address', () => {
      const cfg = makeAlphaPlugin().parseConfig({
        governor_address: '0xc0dA01a04C3f3E0be433606045bB7017A7323E38',
      });
      expect(cfg.governor_address).toBe('0xc0dA01a04C3f3E0be433606045bB7017A7323E38');
    });

    it('#11 — rejects malformed governor_address', () => {
      expect(() => makeAlphaPlugin().parseConfig({ governor_address: 'not-an-address' })).toThrow();
    });

    it('#12 — rejects missing governor_address', () => {
      expect(() => makeAlphaPlugin().parseConfig({})).toThrow();
    });
  });

  describe('buildIngestSpec', () => {
    it('#13 — kind is evm-event-poller', () => {
      const cfg = makeAlphaPlugin().parseConfig({
        governor_address: '0xc0dA01a04C3f3E0be433606045bB7017A7323E38',
      });
      const spec = makeAlphaPlugin().buildIngestSpec(ALPHA_CTX, cfg);
      expect(spec.kind).toBe('evm-event-poller');
    });

    it('#14 — filter.address is lowercased', () => {
      const plugin = makeAlphaPlugin();
      const cfg = plugin.parseConfig({
        governor_address: '0xc0dA01a04C3f3E0be433606045bB7017A7323E38',
      });
      const spec = plugin.buildIngestSpec(ALPHA_CTX, cfg);
      expect(spec.filter.address).toBe('0xc0da01a04c3f3e0be433606045bb7017a7323e38');
    });

    it('#15 — filter.topics is single nested array with 5 topics', () => {
      const plugin = makeAlphaPlugin();
      const cfg = plugin.parseConfig({
        governor_address: '0xc0dA01a04C3f3E0be433606045bB7017A7323E38',
      });
      const spec = plugin.buildIngestSpec(ALPHA_CTX, cfg);
      expect(spec.filter.topics).toHaveLength(1);
      expect(spec.filter.topics![0]).toHaveLength(5);
    });

    it('#16 — listener is a function', () => {
      const plugin = makeAlphaPlugin();
      const cfg = plugin.parseConfig({
        governor_address: '0xc0dA01a04C3f3E0be433606045bB7017A7323E38',
      });
      const spec = plugin.buildIngestSpec(ALPHA_CTX, cfg);
      expect(typeof spec.listener).toBe('function');
    });
  });
});

describe('createCompoundPlugins', () => {
  it('#17 — returns bravo + alpha + oz plugins', () => {
    const plugins = createCompoundPlugins({
      archiveWriter: mockArchiveWriter,
      dlqRepo: mockDlqRepo,
      logger: silentLogger,
    });

    expect(plugins.map((plugin) => plugin.sourceType)).toEqual([
      'compound_governor_bravo',
      'compound_governor_alpha',
      'compound_governor_oz',
    ]);
  });
});

describe('createCompoundGovernorOzPlugin', () => {
  it('#18 — sourceType is compound_governor_oz', () => {
    expect(makeOzPlugin().sourceType).toBe('compound_governor_oz');
  });

  it('#19 — buildIngestSpec lowercases address', () => {
    const plugin = makeOzPlugin();
    const cfg = plugin.parseConfig({
      governor_address: '0x309a862bbC1A00e45506cB8A802D1ff10004c8C0',
    });
    const spec = plugin.buildIngestSpec(OZ_CTX, cfg);
    expect(spec.filter.address).toBe('0x309a862bbc1a00e45506cb8a802d1ff10004c8c0');
  });
});
