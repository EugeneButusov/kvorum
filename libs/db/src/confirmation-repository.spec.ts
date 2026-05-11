import { describe, it, expect, vi } from 'vitest';
import { ConfirmationRepository, isTransientError } from './confirmation-repository';
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

function makeSelectChain(returnValue: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const where = vi.fn();
  const chain = { select: vi.fn(), where, executeTakeFirst };
  chain.select.mockReturnValue(chain);
  where.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), where, executeTakeFirst };
}

function makeInsertChain(opts: { returnValue?: unknown; throws?: unknown } = {}) {
  let capturedValues: unknown;
  let capturedConstraint: string | undefined;
  const executeTakeFirst = opts.throws
    ? vi.fn().mockRejectedValue(opts.throws)
    : vi.fn().mockResolvedValue(opts.returnValue);
  const returning = vi.fn().mockReturnValue({ executeTakeFirst });
  const onConflict = vi
    .fn()
    .mockImplementation(
      (fn: (oc: { constraint: (name: string) => { doNothing: () => unknown } }) => void) => {
        fn({
          constraint: (name) => {
            capturedConstraint = name;
            return { doNothing: () => ({ returning }) };
          },
        });
        return { returning };
      },
    );
  const values = vi.fn().mockImplementation((v: unknown) => {
    capturedValues = v;
    return { onConflict };
  });
  const insertInto = vi.fn().mockReturnValue({ values });
  return {
    insertInto,
    get capturedValues() {
      return capturedValues;
    },
    get capturedConstraint() {
      return capturedConstraint;
    },
  };
}

// Multi-call variant: each element describes one executeTakeFirst invocation.
function makeRetryInsertChain(behaviors: Array<{ id?: string; throws?: unknown }>) {
  let callIndex = 0;
  const executeTakeFirst = vi.fn().mockImplementation(() => {
    const b = behaviors[callIndex++] ?? behaviors[behaviors.length - 1];
    if (b.throws !== undefined) return Promise.reject(b.throws);
    return Promise.resolve(b.id !== undefined ? { id: b.id } : undefined);
  });
  const returning = vi.fn().mockReturnValue({ executeTakeFirst });
  const onConflict = vi
    .fn()
    .mockImplementation(
      (fn: (oc: { constraint: (name: string) => { doNothing: () => unknown } }) => void) => {
        fn({ constraint: () => ({ doNothing: () => ({ returning }) }) });
        return { returning };
      },
    );
  const values = vi.fn().mockReturnValue({ onConflict });
  const insertInto = vi.fn().mockReturnValue({ values });
  return { insertInto, executeTakeFirst };
}

describe('ConfirmationRepository', () => {
  describe('find', () => {
    it('#1 — found: returns row from PG', async () => {
      const expected = { id: 'existing-uuid' };
      const { selectFrom, where, executeTakeFirst } = makeSelectChain(expected);
      const repo = new ConfirmationRepository({ selectFrom } as never);
      const result = await repo.find(KEY);

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith('archive_confirmation');
      expect(where.mock.calls).toEqual([
        ['source_type', '=', 'compound_governor'],
        ['chain_id', '=', 1],
        ['tx_hash', '=', KEY.txHash],
        ['log_index', '=', 3],
        ['block_hash', '=', KEY.blockHash],
      ]);
      expect(executeTakeFirst).toHaveBeenCalledOnce();
    });

    it('#2 — not found: returns undefined', async () => {
      const { selectFrom } = makeSelectChain(undefined);
      const repo = new ConfirmationRepository({ selectFrom } as never);
      expect(await repo.find(KEY)).toBeUndefined();
    });
  });

  describe('insert', () => {
    it('#3 — inserts into archive_confirmation and returns { id } on success', async () => {
      const chain = makeInsertChain({ returnValue: { id: 'new-uuid' } });
      const repo = new ConfirmationRepository({ insertInto: chain.insertInto } as never);
      const result = await repo.insert(PG_ROW);

      expect(chain.insertInto).toHaveBeenCalledWith('archive_confirmation');
      expect(chain.capturedValues).toEqual(PG_ROW);
      expect(result).toEqual({ id: 'new-uuid' });
    });

    it('#4 — uses archive_confirmation_idempotency_key constraint for ON CONFLICT', async () => {
      const chain = makeInsertChain({ returnValue: { id: 'new-uuid' } });
      const repo = new ConfirmationRepository({ insertInto: chain.insertInto } as never);
      await repo.insert(PG_ROW);

      expect(chain.capturedConstraint).toBe('archive_confirmation_idempotency_key');
    });

    it('#5 — returns undefined when ON CONFLICT fires', async () => {
      const chain = makeInsertChain({ returnValue: undefined });
      const repo = new ConfirmationRepository({ insertInto: chain.insertInto } as never);
      expect(await repo.insert(PG_ROW)).toBeUndefined();
    });

    it('#6 — non-transient error propagates immediately without retry', async () => {
      const nonTransient = Object.assign(new Error('FK violation'), { code: '23503' });
      const { insertInto, executeTakeFirst } = makeRetryInsertChain([{ throws: nonTransient }]);
      const repo = new ConfirmationRepository({ insertInto } as never, [0, 0]);
      await expect(repo.insert(PG_ROW)).rejects.toThrow('FK violation');
      expect(executeTakeFirst).toHaveBeenCalledTimes(1);
    });

    it('#7 — transient error retried: succeeds on 3rd attempt', async () => {
      const transient = Object.assign(new Error('conn reset'), { code: 'ECONNRESET' });
      const { insertInto, executeTakeFirst } = makeRetryInsertChain([
        { throws: transient },
        { throws: transient },
        { id: 'uuid-retry' },
      ]);
      const repo = new ConfirmationRepository({ insertInto } as never, [0, 0]);
      const result = await repo.insert(PG_ROW);
      expect(result).toEqual({ id: 'uuid-retry' });
      expect(executeTakeFirst).toHaveBeenCalledTimes(3);
    });

    it('#8 — transient errors exhaust all retries → throws', async () => {
      const transient = Object.assign(new Error('conn reset'), { code: 'ECONNRESET' });
      const { insertInto, executeTakeFirst } = makeRetryInsertChain([
        { throws: transient },
        { throws: transient },
        { throws: transient },
      ]);
      const repo = new ConfirmationRepository({ insertInto } as never, [0, 0]);
      await expect(repo.insert(PG_ROW)).rejects.toThrow('conn reset');
      expect(executeTakeFirst).toHaveBeenCalledTimes(3);
    });
  });

  describe('isTransientError', () => {
    it.each([
      '08000',
      '08001',
      '08003',
      '08006',
      '08007',
      '57P01',
      '57P02',
      '57P03',
      '40001',
      '40P01',
      '53300',
      '08004',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
    ])('code %s → true', (code) => {
      expect(isTransientError({ code })).toBe(true);
    });

    it.each(['23503', '42703', 'UNKNOWN', ''])('code %s → false', (code) => {
      expect(isTransientError({ code })).toBe(false);
    });

    it('plain string → false', () => {
      expect(isTransientError('ECONNRESET')).toBe(false);
    });

    it('null → false', () => {
      expect(isTransientError(null)).toBe(false);
    });
  });
});
