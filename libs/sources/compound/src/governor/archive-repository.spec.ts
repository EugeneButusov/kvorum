import { describe, it, expect, vi } from 'vitest';
import type { NewArchiveConfirmation } from '@libs/db';
import { ArchiveRepository } from './archive-repository';
import type { ArchiveKey, ChEventData } from './archive-repository.types';

// ---- Mock factories ----

/** Proxy that records .where() calls and terminates .executeTakeFirst() with a fixed value. */
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

/** Proxy that captures .values() and .onConflict() args and terminates execute/executeTakeFirst. */
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
        if (prop === 'execute') {
          return opts.throws ? () => Promise.reject(opts.throws) : () => Promise.resolve(undefined);
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

// ---- Fixtures ----

const KEY: ArchiveKey = {
  sourceType: 'compound_governor',
  chainId: 1,
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
  logIndex: 3,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
};

const CH_DATA: ChEventData = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  chainId: 1,
  blockNumber: '20000000',
  blockHash: KEY.blockHash,
  txHash: KEY.txHash,
  logIndex: 3,
  eventType: 'ProposalCreated',
  payload: '{"proposalId":"42"}',
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

// ---- Tests ----

describe('ArchiveRepository', () => {
  describe('findConfirmation', () => {
    it('#1 — found: returns row from PG', async () => {
      const expected = { id: 'existing-uuid' };
      const { proxy, whereCalls } = makeSelectProxy(expected);
      const pgDb = { selectFrom: vi.fn().mockReturnValue(proxy) };

      const repo = new ArchiveRepository({ pgDb, chDb: {} } as never);
      const result = await repo.findConfirmation(KEY);

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

      const repo = new ArchiveRepository({ pgDb, chDb: {} } as never);
      expect(await repo.findConfirmation(KEY)).toBeUndefined();
    });
  });

  describe('insertEvent', () => {
    it('#3 — maps ChEventData fields to snake_case columns', async () => {
      const insert = makeInsertProxy();
      const chDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ArchiveRepository({ pgDb: {}, chDb } as never);
      await repo.insertEvent(CH_DATA);

      expect(chDb.insertInto).toHaveBeenCalledWith('event_archive_compound_governor');
      const vals = insert.capturedValues as Record<string, unknown>;
      expect(vals['dao_source_id']).toBe(CH_DATA.daoSourceId);
      expect(vals['chain_id']).toBe(CH_DATA.chainId);
      expect(vals['block_number']).toBe(CH_DATA.blockNumber);
      expect(vals['block_hash']).toBe(CH_DATA.blockHash);
      expect(vals['tx_hash']).toBe(CH_DATA.txHash);
      expect(vals['log_index']).toBe(CH_DATA.logIndex);
      expect(vals['event_type']).toBe(CH_DATA.eventType);
      expect(vals['payload']).toBe(CH_DATA.payload);
    });

    it('#4 — does not include received_at in CH values', async () => {
      const insert = makeInsertProxy();
      const chDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ArchiveRepository({ pgDb: {}, chDb } as never);
      await repo.insertEvent(CH_DATA);

      expect((insert.capturedValues as Record<string, unknown>)['received_at']).toBeUndefined();
    });

    it('#5 — propagates CH errors', async () => {
      const chErr = new Error('ClickHouse down');
      const insert = makeInsertProxy({ throws: chErr });
      const chDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ArchiveRepository({ pgDb: {}, chDb } as never);
      await expect(repo.insertEvent(CH_DATA)).rejects.toThrow('ClickHouse down');
    });
  });

  describe('insertConfirmation', () => {
    it('#6 — inserts into archive_confirmation and returns { id } on success', async () => {
      const insert = makeInsertProxy({ returnValue: { id: 'new-uuid' } });
      const pgDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ArchiveRepository({ pgDb, chDb: {} } as never);
      const result = await repo.insertConfirmation(PG_ROW);

      expect(pgDb.insertInto).toHaveBeenCalledWith('archive_confirmation');
      expect(result).toEqual({ id: 'new-uuid' });
    });

    it('#7 — uses archive_confirmation_idempotency_key constraint for ON CONFLICT', async () => {
      const insert = makeInsertProxy({ returnValue: { id: 'new-uuid' } });
      const pgDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ArchiveRepository({ pgDb, chDb: {} } as never);
      await repo.insertConfirmation(PG_ROW);

      expect(insert.capturedConstraint).toBe('archive_confirmation_idempotency_key');
    });

    it('#8 — returns undefined when ON CONFLICT fires', async () => {
      const insert = makeInsertProxy({ returnValue: undefined });
      const pgDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ArchiveRepository({ pgDb, chDb: {} } as never);
      expect(await repo.insertConfirmation(PG_ROW)).toBeUndefined();
    });

    it('#9 — propagates PG errors', async () => {
      const pgErr = new Error('connection refused');
      const insert = makeInsertProxy({ throws: pgErr });
      const pgDb = { insertInto: vi.fn().mockReturnValue(insert.proxy) };

      const repo = new ArchiveRepository({ pgDb, chDb: {} } as never);
      await expect(repo.insertConfirmation(PG_ROW)).rejects.toThrow('connection refused');
    });
  });
});
