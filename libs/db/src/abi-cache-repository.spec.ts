import { describe, expect, it, vi } from 'vitest';
import { AbiCacheRepository } from './abi-cache-repository';
import type { NewAbiCache } from './schema/pg';

const SAMPLE_ABI = [{ type: 'function', name: 'transfer', inputs: [], outputs: [] }];

function makeCacheRow(overrides: Partial<NewAbiCache> = {}): NewAbiCache {
  return {
    chain_id: '0x1',
    address: '0xabc',
    abi: SAMPLE_ABI,
    source: 'bundled_library',
    fetched_at: new Date('2026-01-01T00:00:00Z'),
    implementation_chain: null,
    ...overrides,
  };
}

function makeSelectChain(returnValue: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = { selectAll: vi.fn(), where: vi.fn(), executeTakeFirst };
  chain.selectAll.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  const selectFrom = vi.fn().mockReturnValue(chain);
  return { selectFrom, ...chain };
}

function makeInsertChain() {
  let capturedValues: unknown;
  let capturedUpdateSet: unknown;
  const execute = vi.fn().mockResolvedValue(undefined);
  const doUpdateSet = vi.fn().mockImplementation((set: unknown) => {
    capturedUpdateSet = set;
    return { execute };
  });
  const onConflict = vi.fn().mockImplementation((fn: (oc: ConflictBuilder) => unknown) => {
    fn({ constraint: () => ({ doUpdateSet }) });
    return { execute };
  });
  const values = vi.fn().mockImplementation((v: unknown) => {
    capturedValues = v;
    return { onConflict };
  });
  const insertInto = vi.fn().mockReturnValue({ values });
  return {
    insertInto,
    execute,
    get capturedValues() {
      return capturedValues as NewAbiCache;
    },
    get capturedUpdateSet() {
      return capturedUpdateSet;
    },
  };
}

interface ConflictBuilder {
  constraint(name: string): { doUpdateSet(set: unknown): unknown };
}

describe('AbiCacheRepository', () => {
  describe('findByAddress', () => {
    it('selects from abi_cache by chain_id and lowercased address', async () => {
      const expected = makeCacheRow();
      const select = makeSelectChain(expected);
      const repo = new AbiCacheRepository({ selectFrom: select.selectFrom } as never);

      const result = await repo.findByAddress('1', '0xABC');

      expect(result).toEqual(expected);
      expect(select.selectFrom).toHaveBeenCalledWith('abi_cache');
      expect(select.where.mock.calls).toEqual([
        ['chain_id', '=', '1'],
        ['address', '=', '0xabc'],
      ]);
    });

    it('returns undefined when not found', async () => {
      const select = makeSelectChain(undefined);
      const repo = new AbiCacheRepository({ selectFrom: select.selectFrom } as never);
      expect(await repo.findByAddress('1', '0xabc')).toBeUndefined();
    });
  });

  describe('upsert', () => {
    it('normalises address to lowercase before inserting', async () => {
      const insert = makeInsertChain();
      const repo = new AbiCacheRepository({ insertInto: insert.insertInto } as never);

      await repo.upsert(makeCacheRow({ address: '0xABC' }));

      expect(insert.capturedValues).toMatchObject({ address: '0xabc' });
    });

    it('uses abi_cache_pkey conflict constraint', async () => {
      const insert = makeInsertChain();
      const repo = new AbiCacheRepository({ insertInto: insert.insertInto } as never);

      await repo.upsert(makeCacheRow());

      expect(insert.insertInto).toHaveBeenCalledWith('abi_cache');
    });

    it('doUpdateSet includes abi, source, fetched_at, implementation_chain', async () => {
      const insert = makeInsertChain();
      const repo = new AbiCacheRepository({ insertInto: insert.insertInto } as never);
      const fetchedAt = new Date('2026-06-01T00:00:00Z');

      await repo.upsert(
        makeCacheRow({
          abi: SAMPLE_ABI,
          source: 'etherscan',
          fetched_at: fetchedAt,
          implementation_chain: ['0xproxy'],
        }),
      );

      expect(insert.capturedUpdateSet).toMatchObject({
        source: 'etherscan',
        fetched_at: fetchedAt,
        implementation_chain: ['0xproxy'],
      });
    });

    it('coerces missing implementation_chain to null in update set', async () => {
      const insert = makeInsertChain();
      const repo = new AbiCacheRepository({ insertInto: insert.insertInto } as never);

      await repo.upsert(makeCacheRow({ implementation_chain: undefined }));

      const updateSet = insert.capturedUpdateSet as Record<string, unknown>;
      expect(updateSet['implementation_chain']).toBeNull();
    });
  });
});
