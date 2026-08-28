import { describe, expect, it, vi, beforeEach } from 'vitest';

let mockRows: unknown[] = [];
const mockExecute = vi.fn().mockImplementation(() => Promise.resolve({ rows: mockRows }));

vi.mock('kysely', () => {
  const sqlTag = (..._args: unknown[]) => ({ execute: mockExecute });
  return { sql: sqlTag };
});

import { SearchReadRepository } from './search-read-repository';

const fakeDb = {} as never;

describe('SearchReadRepository', () => {
  beforeEach(() => {
    mockRows = [];
    mockExecute.mockClear();
  });

  describe('searchProposals', () => {
    it('returns proposal rows from FTS query', async () => {
      const rows = [
        {
          dao_slug: 'compound',
          dao_name: 'Compound',
          source_type: 'compound_governor_bravo',
          source_id: '42',
          title: 'Add WBTC market',
          state: 'active',
          voting_starts_at: new Date('2026-03-01T12:00:00Z'),
          rank: 0.85,
        },
      ];
      mockRows = rows;
      const repo = new SearchReadRepository(fakeDb);

      const result = await repo.searchProposals('compound', 5);

      expect(result).toEqual(rows);
      expect(mockExecute).toHaveBeenCalledWith(fakeDb);
    });

    it('returns empty array when no proposals match', async () => {
      mockRows = [];
      const repo = new SearchReadRepository(fakeDb);

      const result = await repo.searchProposals('nonexistent', 5);

      expect(result).toEqual([]);
    });
  });

  describe('searchDaos', () => {
    it('returns DAO rows from FTS query', async () => {
      const rows = [{ slug: 'aave', name: 'Aave', description: 'Aave governance', rank: 0.9 }];
      mockRows = rows;
      const repo = new SearchReadRepository(fakeDb);

      const result = await repo.searchDaos('aave', 5);

      expect(result).toEqual(rows);
      expect(mockExecute).toHaveBeenCalledWith(fakeDb);
    });

    it('returns empty array when no DAOs match', async () => {
      mockRows = [];
      const repo = new SearchReadRepository(fakeDb);

      const result = await repo.searchDaos('nonexistent', 5);

      expect(result).toEqual([]);
    });
  });

  describe('searchActors', () => {
    it('returns actor rows from FTS query', async () => {
      const rows = [
        {
          display_name: 'Alice',
          primary_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          rank: 0.7,
        },
      ];
      mockRows = rows;
      const repo = new SearchReadRepository(fakeDb);

      const result = await repo.searchActors('alice', 5);

      expect(result).toEqual(rows);
    });

    it('returns empty array when no actors match', async () => {
      mockRows = [];
      const repo = new SearchReadRepository(fakeDb);

      const result = await repo.searchActors('nonexistent', 5);

      expect(result).toEqual([]);
    });
  });

  describe('lookupActorsByAddress', () => {
    it('returns actors for an exact address match', async () => {
      const address = '0x' + 'ab'.repeat(20);
      const rows = [{ display_name: 'Bob', primary_address: address, rank: 1.0 }];
      mockRows = rows;
      const repo = new SearchReadRepository(fakeDb);

      const result = await repo.lookupActorsByAddress(address, true, 5);

      expect(result).toEqual(rows);
    });

    it('returns actors for a prefix address match', async () => {
      const rows = [
        {
          display_name: null,
          primary_address: '0xabcdef1234567890abcdef1234567890abcdef12',
          rank: 1.0,
        },
      ];
      mockRows = rows;
      const repo = new SearchReadRepository(fakeDb);

      const result = await repo.lookupActorsByAddress('0xabcdef', false, 5);

      expect(result).toEqual(rows);
    });

    it('returns empty array when no addresses match', async () => {
      mockRows = [];
      const repo = new SearchReadRepository(fakeDb);

      const result = await repo.lookupActorsByAddress('0x1234', false, 5);

      expect(result).toEqual([]);
    });
  });
});
