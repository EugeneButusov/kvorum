import { describe, it, expect, vi } from 'vitest';
import type { DaoSourceRepository } from '@libs/db';
import type { SourceIngester } from '@sources/core';
import { SourceResolver } from './source-resolver';

// ── helpers ──────────────────────────────────────────────────────────────────

type DaoSourceRow = Awaited<ReturnType<DaoSourceRepository['findAll']>>[number];

function makeRow(overrides: Partial<DaoSourceRow> = {}): DaoSourceRow {
  return {
    id: 'src-1',
    dao_id: 'dao-1',
    source_type: 'compound_governor_bravo',
    source_config: { address: '0xc0da02939e1441f497fd74f78ce7decb17b66529' },
    chain_id: '0x1',
    ...overrides,
  };
}

function makeIngester(
  overrides: Partial<{
    sourceType: string;
    supportedChainIds: string[];
    parseConfig: (raw: unknown) => unknown;
    buildIngestSpec: ReturnType<typeof vi.fn>;
  }> = {},
): SourceIngester {
  return {
    sourceType: 'compound_governor_bravo',
    supportedChainIds: ['0x1'],
    parseConfig: vi.fn().mockReturnValue({}),
    buildIngestSpec: vi.fn().mockReturnValue({
      kind: 'evm-event-poller',
      filter: { address: '0xc0da02939e1441f497fd74f78ce7decb17b66529' },
    }),
    ...overrides,
  } as unknown as SourceIngester;
}

function makeDaoSourceRepo(rows: DaoSourceRow[] = []): DaoSourceRepository {
  return { findAll: vi.fn().mockResolvedValue(rows) } as unknown as DaoSourceRepository;
}

function makeResolver(ingesters: SourceIngester[], rows: DaoSourceRow[]): SourceResolver {
  return new SourceResolver(ingesters, makeDaoSourceRepo(rows));
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('SourceResolver', () => {
  describe('rebuild()', () => {
    it('resolves a single-address source after rebuild', async () => {
      const resolver = makeResolver([makeIngester()], [makeRow()]);
      await resolver.rebuild();

      const result = resolver.resolve('0x1', '0xc0da02939e1441f497fd74f78ce7decb17b66529');
      expect(result).toMatchObject({
        daoSourceId: 'src-1',
        sourceType: 'compound_governor_bravo',
        sourceLabel: 'compound_governor_bravo',
        chainId: '0x1',
      });
    });

    it('maps all addresses when spec.filter.address is an array', async () => {
      const addrA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const addrB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const ingester = makeIngester({
        buildIngestSpec: vi.fn().mockReturnValue({
          kind: 'evm-event-poller',
          filter: { address: [addrA, addrB] },
        }),
      });
      const resolver = makeResolver([ingester], [makeRow()]);
      await resolver.rebuild();

      expect(resolver.resolve('0x1', addrA)).toBeDefined();
      expect(resolver.resolve('0x1', addrB)).toBeDefined();
    });

    it('normalises addresses to lowercase so any casing resolves', async () => {
      const checksummed = '0xC0Da02939E1441F497fd74f78cE7dEcb17B66529';
      const ingester = makeIngester({
        buildIngestSpec: vi.fn().mockReturnValue({
          kind: 'evm-event-poller',
          filter: { address: checksummed },
        }),
      });
      const resolver = makeResolver([ingester], [makeRow()]);
      await resolver.rebuild();

      // stored as lowercase — all three call-site casings hit the same entry
      expect(resolver.resolve('0x1', checksummed.toLowerCase())).toBeDefined();
      expect(resolver.resolve('0x1', checksummed.toUpperCase())).toBeDefined();
      expect(resolver.resolve('0x1', checksummed)).toBeDefined();
    });

    it('skips sources whose source_type has no registered ingester', async () => {
      const resolver = makeResolver(
        [makeIngester({ sourceType: 'other_type' })],
        [makeRow({ source_type: 'compound_governor_bravo' })],
      );
      await resolver.rebuild();

      expect(resolver.resolve('0x1', '0xc0da02939e1441f497fd74f78ce7decb17b66529')).toBeUndefined();
    });

    it('skips sources whose chainId is not in ingester.supportedChainIds', async () => {
      const resolver = makeResolver(
        [makeIngester({ supportedChainIds: ['0x89'] })],
        [makeRow({ chain_id: '0x1' })],
      );
      await resolver.rebuild();

      expect(resolver.resolve('0x1', '0xc0da02939e1441f497fd74f78ce7decb17b66529')).toBeUndefined();
    });

    it('skips sources where parseConfig throws', async () => {
      const ingester = makeIngester({
        parseConfig: vi.fn().mockImplementation(() => {
          throw new Error('invalid config');
        }),
      });
      const resolver = makeResolver([ingester], [makeRow()]);
      await resolver.rebuild();

      expect(resolver.resolve('0x1', '0xc0da02939e1441f497fd74f78ce7decb17b66529')).toBeUndefined();
    });

    it('skips sources whose buildIngestSpec returns a non-evm-event-poller kind', async () => {
      const ingester = makeIngester({
        buildIngestSpec: vi.fn().mockReturnValue({ kind: 'evm-block-head-poller' }),
      });
      const resolver = makeResolver([ingester], [makeRow()]);
      await resolver.rebuild();

      expect(resolver.resolve('0x1', '0xc0da02939e1441f497fd74f78ce7decb17b66529')).toBeUndefined();
    });

    it('atomically replaces the map on a second rebuild', async () => {
      const addrOld = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const addrNew = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      const daoSourceRepo = {
        findAll: vi
          .fn()
          .mockResolvedValueOnce([
            makeRow({
              source_config: {},
              id: 'src-old',
            }),
          ])
          .mockResolvedValueOnce([
            makeRow({
              source_config: {},
              id: 'src-new',
            }),
          ]),
      } as unknown as DaoSourceRepository;

      const ingester = {
        sourceType: 'compound_governor_bravo',
        supportedChainIds: ['0x1'],
        parseConfig: vi.fn().mockReturnValue({}),
        buildIngestSpec: vi
          .fn()
          .mockReturnValueOnce({ kind: 'evm-event-poller', filter: { address: addrOld } })
          .mockReturnValueOnce({ kind: 'evm-event-poller', filter: { address: addrNew } }),
      } as unknown as SourceIngester;

      const resolver = new SourceResolver([ingester], daoSourceRepo);

      await resolver.rebuild();
      expect(resolver.resolve('0x1', addrOld)).toBeDefined();

      await resolver.rebuild();
      expect(resolver.resolve('0x1', addrOld)).toBeUndefined();
      expect(resolver.resolve('0x1', addrNew)).toBeDefined();
    });

    it('populates entries from multiple valid sources', async () => {
      const ingester = makeIngester({
        buildIngestSpec: vi
          .fn()
          .mockReturnValueOnce({
            kind: 'evm-event-poller',
            filter: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
          })
          .mockReturnValueOnce({
            kind: 'evm-event-poller',
            filter: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
          }),
      });
      const rows = [makeRow({ id: 'src-1' }), makeRow({ id: 'src-2' })];
      const resolver = makeResolver([ingester], rows);
      await resolver.rebuild();

      expect(resolver.resolve('0x1', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeDefined();
      expect(resolver.resolve('0x1', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBeDefined();
    });
  });

  describe('resolve()', () => {
    it('returns undefined before any rebuild', () => {
      const resolver = makeResolver([makeIngester()], [makeRow()]);
      expect(resolver.resolve('0x1', '0xc0da02939e1441f497fd74f78ce7decb17b66529')).toBeUndefined();
    });

    it('is case-insensitive on the address parameter', async () => {
      const resolver = makeResolver([makeIngester()], [makeRow()]);
      await resolver.rebuild();

      const upper = '0xC0DA02939E1441F497FD74F78CE7DECB17B66529';
      expect(resolver.resolve('0x1', upper)).toBeDefined();
    });
  });

  describe('onApplicationBootstrap()', () => {
    it('calls rebuild and populates the map', async () => {
      const resolver = makeResolver([makeIngester()], [makeRow()]);
      await resolver.onApplicationBootstrap();

      expect(resolver.resolve('0x1', '0xc0da02939e1441f497fd74f78ce7decb17b66529')).toBeDefined();
    });
  });
});
