import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { EasyTrackArchivePayloadRepository } from './archive-payload-repository';

function makeChDb(rows: unknown[]) {
  const execute = vi.fn().mockResolvedValue(rows);
  const chain = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    execute,
  };
  const selectFrom = vi.fn().mockReturnValue(chain);
  return { chDb: { selectFrom } as never, selectFrom, chain };
}

const ROW = {
  chain_id: '0x1',
  tx_hash: '0x' + 'cd'.repeat(32),
  log_index: 0,
  block_hash: '0x' + 'ab'.repeat(32),
} as unknown as ArchiveDerivationRow;

describe('EasyTrackArchivePayloadRepository', () => {
  it('returns [] without querying when there are no rows', async () => {
    const { chDb, selectFrom } = makeChDb([]);
    const repo = new EasyTrackArchivePayloadRepository(chDb);
    await expect(repo.fetchPayloads([])).resolves.toEqual([]);
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it('queries archive_event_easy_track ordered by received_at asc', async () => {
    const found = [{ event_type: 'MotionCreated', payload: '{}' }];
    const { chDb, selectFrom, chain } = makeChDb(found);
    const repo = new EasyTrackArchivePayloadRepository(chDb);
    const out = await repo.fetchPayloads([ROW]);
    expect(selectFrom).toHaveBeenCalledWith('archive_event_easy_track');
    expect(chain.orderBy).toHaveBeenCalledWith('received_at', 'asc');
    expect(out).toBe(found);
  });

  describe('findEventsInTx', () => {
    it('filters by chain_id, tx_hash and event_type, ordered by received_at asc', async () => {
      const found = [{ event_type: 'MotionEnacted', payload: '{"motionId":"42"}' }];
      const { chDb, selectFrom, chain } = makeChDb(found);
      const repo = new EasyTrackArchivePayloadRepository(chDb);
      const tx = '0x' + 'cd'.repeat(32);

      const out = await repo.findEventsInTx('0x1', tx, 'MotionEnacted');

      expect(selectFrom).toHaveBeenCalledWith('archive_event_easy_track');
      expect(chain.where.mock.calls).toEqual([
        ['chain_id', '=', '0x1'],
        ['tx_hash', '=', tx],
        ['event_type', '=', 'MotionEnacted'],
      ]);
      expect(chain.orderBy).toHaveBeenCalledWith('received_at', 'asc');
      expect(out).toBe(found);
    });

    it('returns [] when no event of that type is in the tx', async () => {
      const { chDb } = makeChDb([]);
      const repo = new EasyTrackArchivePayloadRepository(chDb);
      await expect(repo.findEventsInTx('0x1', '0xtx', 'MotionEnacted')).resolves.toEqual([]);
    });
  });

  describe('findDurationAsOf', () => {
    function makeDurationChDb(row: { payload: string } | undefined) {
      const executeTakeFirst = vi.fn().mockResolvedValue(row);
      const chain = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        executeTakeFirst,
      };
      const selectFrom = vi.fn().mockReturnValue(chain);
      return { chDb: { selectFrom } as never, selectFrom, chain };
    }

    it('returns the motionDuration of the latest MotionDurationChanged at or before the block', async () => {
      const { chDb, selectFrom, chain } = makeDurationChDb({
        payload: JSON.stringify({ motionDuration: '259200' }),
      });
      const repo = new EasyTrackArchivePayloadRepository(chDb);

      const out = await repo.findDurationAsOf('0x1', '13700000');

      expect(selectFrom).toHaveBeenCalledWith('archive_event_easy_track');
      expect(chain.where).toHaveBeenCalledWith('chain_id', '=', '0x1');
      expect(chain.where).toHaveBeenCalledWith('event_type', '=', 'MotionDurationChanged');
      // block_number bound is a toUInt64-cast sql fragment (UInt64 vs UInt64); assert latest-first order.
      expect(chain.where).toHaveBeenCalledTimes(3);
      expect(chain.orderBy.mock.calls).toEqual([
        ['block_number', 'desc'],
        ['log_index', 'desc'],
      ]);
      expect(out).toBe('259200');
    });

    it('returns null when no MotionDurationChanged precedes the block', async () => {
      const { chDb } = makeDurationChDb(undefined);
      const repo = new EasyTrackArchivePayloadRepository(chDb);
      await expect(repo.findDurationAsOf('0x1', '13676729')).resolves.toBeNull();
    });

    it('returns null when the payload lacks a motionDuration', async () => {
      const { chDb } = makeDurationChDb({ payload: JSON.stringify({ other: 'x' }) });
      const repo = new EasyTrackArchivePayloadRepository(chDb);
      await expect(repo.findDurationAsOf('0x1', '13700000')).resolves.toBeNull();
    });
  });
});
