import { describe, it, expect, vi } from 'vitest';
import type { OffchainArchiveRow } from '@libs/db';
import { SnapshotArchivePayloadRepository } from './archive-payload-repository';

function row(externalId: string): OffchainArchiveRow {
  return {
    id: 'r',
    source_type: 'snapshot',
    dao_source_id: 's',
    chain_id: 'off-chain',
    external_id: externalId,
    derivation_ordinal: '1',
    event_type: 'SnapshotProposalCreated',
    received_at: new Date(),
    derivation_attempt_count: 0,
  };
}

function mockChDb(rows: Array<{ external_id: string; version: number; payload: string }>) {
  const execute = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ execute }));
  const select = vi.fn(() => ({ where }));
  const selectFrom = vi.fn(() => ({ select }));
  return { db: { selectFrom } as never, selectFrom, where };
}

describe('SnapshotArchivePayloadRepository', () => {
  it('returns [] without querying for an empty batch', async () => {
    const { db, selectFrom } = mockChDb([]);
    const repo = new SnapshotArchivePayloadRepository(db);
    expect(await repo.fetchLatest([])).toEqual([]);
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it('reads the max-version payload per external_id', async () => {
    const { db, selectFrom, where } = mockChDb([
      { external_id: 'prop:0x1', version: 1, payload: '{"v":1}' },
      { external_id: 'prop:0x1', version: 2, payload: '{"v":2}' },
      { external_id: 'prop:0x2', version: 1, payload: '{"v":1}' },
    ]);
    const repo = new SnapshotArchivePayloadRepository(db);

    const result = await repo.fetchLatest([row('prop:0x1'), row('prop:0x2')]);

    expect(selectFrom).toHaveBeenCalledWith('archive_event_snapshot');
    expect(where).toHaveBeenCalledWith('external_id', 'in', ['prop:0x1', 'prop:0x2']);
    expect(result).toEqual([
      { external_id: 'prop:0x1', payload: '{"v":2}' },
      { external_id: 'prop:0x2', payload: '{"v":1}' },
    ]);
  });

  it('fetchByExternalId returns the max-version payload for one external_id', async () => {
    const { db, selectFrom, where } = mockChDb([
      { external_id: 'prop:0x1', version: 1, payload: '{"v":1}' },
      { external_id: 'prop:0x1', version: 3, payload: '{"v":3}' },
      { external_id: 'prop:0x1', version: 2, payload: '{"v":2}' },
    ]);
    const repo = new SnapshotArchivePayloadRepository(db);

    expect(await repo.fetchByExternalId('prop:0x1')).toBe('{"v":3}');
    expect(selectFrom).toHaveBeenCalledWith('archive_event_snapshot');
    expect(where).toHaveBeenCalledWith('external_id', '=', 'prop:0x1');
  });

  it('fetchByExternalId returns undefined when nothing is archived', async () => {
    const { db } = mockChDb([]);
    const repo = new SnapshotArchivePayloadRepository(db);
    expect(await repo.fetchByExternalId('prop:missing')).toBeUndefined();
  });
});
