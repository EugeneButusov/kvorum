import { describe, expect, it, vi } from 'vitest';
import { ZERO_DELEGATE_ADDRESS } from '@libs/db';
import {
  SnapshotDelegationRepository,
  resolveCurrentDelegateRegistry,
  resolveCurrentSplit,
} from './snapshot-delegation-repository';
import type { NewSnapshotDelegation, SnapshotDelegation } from '../persistence/schema';

let seq = 0;
function row(partial: Partial<SnapshotDelegation>): SnapshotDelegation {
  return {
    id: `id-${seq++}`,
    dao_id: 'dao-1',
    delegator_address: `0x${'11'.repeat(20)}`,
    delegate_address: `0x${'22'.repeat(20)}`,
    space_id: 'lido-snapshot.eth',
    network: '0x1',
    delegation_system: 'delegate_registry',
    weight: null,
    expires_at: null,
    event_type: 'set',
    block_number: '100',
    log_index: 0,
    tx_hash: '0xtx',
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  };
}

describe('resolveCurrentDelegateRegistry (space-over-global precedence)', () => {
  it('returns the space-specific delegation when one is active', () => {
    const rows = [
      row({ space_id: null, delegate_address: `0x${'aa'.repeat(20)}`, block_number: '50' }),
      row({
        space_id: 'lido-snapshot.eth',
        delegate_address: `0x${'bb'.repeat(20)}`,
        block_number: '60',
      }),
    ];
    expect(resolveCurrentDelegateRegistry(rows, 'lido-snapshot.eth')?.delegate_address).toBe(
      `0x${'bb'.repeat(20)}`,
    );
  });

  it('falls back to global when the space-specific delegation was cleared', () => {
    const rows = [
      row({ space_id: null, delegate_address: `0x${'aa'.repeat(20)}`, block_number: '50' }),
      row({
        space_id: 'lido-snapshot.eth',
        delegate_address: `0x${'bb'.repeat(20)}`,
        block_number: '60',
      }),
      row({
        space_id: 'lido-snapshot.eth',
        event_type: 'clear',
        delegate_address: ZERO_DELEGATE_ADDRESS,
        block_number: '70',
      }),
    ];
    expect(resolveCurrentDelegateRegistry(rows, 'lido-snapshot.eth')?.delegate_address).toBe(
      `0x${'aa'.repeat(20)}`,
    );
  });

  it('uses the latest space-specific event by (block, log)', () => {
    const rows = [
      row({
        space_id: 'lido-snapshot.eth',
        delegate_address: `0x${'bb'.repeat(20)}`,
        block_number: '60',
        log_index: 1,
      }),
      row({
        space_id: 'lido-snapshot.eth',
        delegate_address: `0x${'cc'.repeat(20)}`,
        block_number: '60',
        log_index: 2,
      }),
    ];
    expect(resolveCurrentDelegateRegistry(rows, 'lido-snapshot.eth')?.delegate_address).toBe(
      `0x${'cc'.repeat(20)}`,
    );
  });

  it('returns null when nothing is delegated', () => {
    expect(resolveCurrentDelegateRegistry([], 'lido-snapshot.eth')).toBeNull();
  });

  it('returns null when only a cleared global remains', () => {
    const rows = [
      row({ space_id: null, event_type: 'clear', delegate_address: ZERO_DELEGATE_ADDRESS }),
    ];
    expect(resolveCurrentDelegateRegistry(rows, 'lido-snapshot.eth')).toBeNull();
  });
});

describe('resolveCurrentSplit', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('returns the delegate set at the latest non-cleared coordinate', () => {
    const rows = [
      row({
        delegation_system: 'split_delegation',
        delegate_address: `0x${'22'.repeat(20)}`,
        weight: '0.5',
        block_number: '100',
      }),
      row({
        delegation_system: 'split_delegation',
        delegate_address: `0x${'33'.repeat(20)}`,
        weight: '0.5',
        block_number: '100',
      }),
    ];
    const current = resolveCurrentSplit(rows, now);
    expect(current.map((c) => c.delegate_address).sort()).toEqual(
      [`0x${'22'.repeat(20)}`, `0x${'33'.repeat(20)}`].sort(),
    );
  });

  it('excludes expired delegations', () => {
    const rows = [
      row({
        delegation_system: 'split_delegation',
        delegate_address: `0x${'22'.repeat(20)}`,
        expires_at: new Date('2026-01-01T00:00:00Z'),
        block_number: '100',
      }),
    ];
    expect(resolveCurrentSplit(rows, now)).toEqual([]);
  });

  it('returns [] when the latest coordinate is a clear', () => {
    const rows = [
      row({
        delegation_system: 'split_delegation',
        delegate_address: `0x${'22'.repeat(20)}`,
        block_number: '100',
      }),
      row({
        delegation_system: 'split_delegation',
        event_type: 'clear',
        delegate_address: ZERO_DELEGATE_ADDRESS,
        block_number: '110',
      }),
    ];
    expect(resolveCurrentSplit(rows, now)).toEqual([]);
  });

  it('returns [] for no rows', () => {
    expect(resolveCurrentSplit([], now)).toEqual([]);
  });
});

describe('SnapshotDelegationRepository.insertBatch', () => {
  it('no-ops on an empty batch', async () => {
    const insertInto = vi.fn();
    const repo = new SnapshotDelegationRepository({ insertInto } as never);
    await repo.insertBatch([]);
    expect(insertInto).not.toHaveBeenCalled();
  });

  it('inserts with ON CONFLICT DO NOTHING on the idempotency key', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const doNothing = vi.fn().mockReturnValue({});
    const columns = vi.fn().mockReturnValue({ doNothing });
    const onConflict = vi.fn().mockImplementation((cb: (oc: unknown) => unknown) => {
      cb({ columns });
      return { execute };
    });
    const values = vi.fn().mockReturnValue({ onConflict });
    const insertInto = vi.fn().mockReturnValue({ values });
    const repo = new SnapshotDelegationRepository({ insertInto } as never);
    const rowToInsert = { ...row({}) } as unknown as NewSnapshotDelegation;
    await repo.insertBatch([rowToInsert]);
    expect(insertInto).toHaveBeenCalledWith('snapshot_delegation');
    expect(columns).toHaveBeenCalledWith(['network', 'tx_hash', 'log_index', 'delegate_address']);
    expect(execute).toHaveBeenCalledOnce();
  });
});
