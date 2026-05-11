import { describe, it, expect, vi } from 'vitest';
import { ConfirmationRepository } from './confirmation-repository';
import type { ConfirmationKey } from './confirmation-repository';
import type { NewArchiveConfirmation } from './schema/pg';

const KEY: ConfirmationKey = {
  sourceType: 'compound_governor',
  chainId: 1,
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
  logIndex: 3,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
};

const PG_ROW: NewArchiveConfirmation = {
  source_type: 'compound_governor',
  dao_source_id: '00000000-0000-0000-0000-000000000001',
  chain_id: 1,
  block_number: '20000000',
  block_hash: KEY.blockHash,
  tx_hash: KEY.txHash,
  log_index: 3,
  event_type: 'ProposalCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  confirmation_status: 'pending',
  confirmed_at: null,
  orphaned_at: null,
  orphaned_by_reorg_event_id: null,
  derived_at: null,
};

function makeSelectProxy(returnValue: unknown) {
  const whereCalls: Array<[string, string, unknown]> = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'where') {
          return (col: string, op: string, val: unknown) => {
            whereCalls.push([col, op, val]);
            return proxy;
          };
        }
        if (prop === 'executeTakeFirst') return () => Promise.resolve(returnValue);
        return () => proxy;
      },
    },
  );
  return { proxy, whereCalls };
}

function makeInsertProxy(opts: { returnValue?: unknown; throws?: unknown } = {}) {
  let capturedValues: unknown;
  let capturedConstraint: string | undefined;

  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'values') {
          return (v: unknown) => {
            capturedValues = v;
            return proxy;
          };
        }
        if (prop === 'onConflict') {
          return (
            fn: (oc: { constraint: (name: string) => { doNothing: () => unknown } }) => void,
          ) => {
            fn({
              constraint: (name: string) => {
                capturedConstraint = name;
                return { doNothing: () => proxy };
              },
            });
            return proxy;
          };
        }
        if (prop === 'executeTakeFirst') {
          return opts.throws
            ? () => Promise.reject(opts.throws)
            : () => Promise.resolve(opts.returnValue);
        }
        return () => proxy;
      },
    },
  );

  return {
    proxy,
    get capturedValues() {
      return capturedValues;
    },
    get capturedConstraint() {
      return capturedConstraint;
    },
  };
}

describe('ConfirmationRepository', () => {
  describe('find', () => {
    it('#1 — found: returns row from PG', async () => {
      const expected = { id: 'existing-uuid' };
      const { proxy, whereCalls } = makeSelectProxy(expected);
      const pgDb = { selectFrom: vi.fn().mockReturnValue(proxy) };

      const repo = new ConfirmationRepository(pgDb as never);
      const result = await repo.find(KEY);

      expect(result).toEqual(expected);
      expect(pgDb.selectFrom).toHaveBeenCalledWith('archive_confirmation');
      expect(whereCalls).toEqual([
        ['source_type', '=', 'compound_governor'],
        ['chain_id', '=', 1],
        ['tx_hash', '=', KEY.txHash],
        ['log_index', '=', 3],
        ['block_hash', '=', KEY.blockHash],
      ]);
    });

    it('#2 — not found: returns undefined', async () => {
      const { proxy } = makeSelectProxy(undefined);
      const pgDb = { selectFrom: vi.fn().mockReturnValue(proxy) };

      const repo = new ConfirmationRepository(pgDb as never);
      expect(await repo.find(KEY)).toBeUndefined();
    });
  });

  describe('insert', () => {
    it('#3 — inserts into archive_confirmation and returns { id } on success', async () => {
      const insert = makeInsertProxy({ returnValue: { id: 'new-uuid' } });
      const pgDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ConfirmationRepository(pgDb as never);
      const result = await repo.insert(PG_ROW);

      expect(pgDb.insertInto).toHaveBeenCalledWith('archive_confirmation');
      expect(result).toEqual({ id: 'new-uuid' });
    });

    it('#4 — uses archive_confirmation_idempotency_key constraint for ON CONFLICT', async () => {
      const insert = makeInsertProxy({ returnValue: { id: 'new-uuid' } });
      const pgDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ConfirmationRepository(pgDb as never);
      await repo.insert(PG_ROW);

      expect(insert.capturedConstraint).toBe('archive_confirmation_idempotency_key');
    });

    it('#5 — returns undefined when ON CONFLICT fires', async () => {
      const insert = makeInsertProxy({ returnValue: undefined });
      const pgDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ConfirmationRepository(pgDb as never);
      expect(await repo.insert(PG_ROW)).toBeUndefined();
    });

    it('#6 — propagates PG errors', async () => {
      const pgErr = new Error('connection refused');
      const insert = makeInsertProxy({ throws: pgErr });
      const pgDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ConfirmationRepository(pgDb as never);
      await expect(repo.insert(PG_ROW)).rejects.toThrow('connection refused');
    });
  });
});
