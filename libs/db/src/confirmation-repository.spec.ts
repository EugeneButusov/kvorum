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

    it('#6 — propagates PG errors', async () => {
      const pgErr = new Error('connection refused');
      const chain = makeInsertChain({ throws: pgErr });
      const repo = new ConfirmationRepository({ insertInto: chain.insertInto } as never);
      await expect(repo.insert(PG_ROW)).rejects.toThrow('connection refused');
    });
  });
});
