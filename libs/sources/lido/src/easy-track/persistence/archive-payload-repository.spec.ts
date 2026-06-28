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
});
