import { describe, expect, it } from 'vitest';
import { resolveActorCurrentDelegations } from './snapshot-delegation-read-repository';
import type { SnapshotDelegation } from '../persistence/schema';

function row(over: Partial<SnapshotDelegation>): SnapshotDelegation {
  return {
    id: 'x',
    dao_id: 'dao-1',
    delegator_address: '0xaa',
    delegate_address: '0xbb',
    space_id: 'lido-snapshot.eth',
    network: '0x1',
    delegation_system: 'delegate_registry',
    weight: null,
    expires_at: null,
    event_type: 'set',
    block_number: '100',
    log_index: 0,
    tx_hash: '0xhash',
    created_at: new Date('2026-01-01'),
    ...over,
  };
}

const NOW = new Date('2026-06-01T00:00:00Z');

describe('resolveActorCurrentDelegations', () => {
  it('returns the latest SET per (space, system) for delegate_registry', () => {
    const out = resolveActorCurrentDelegations(
      [
        row({ delegate_address: '0xold', block_number: '100' }),
        row({ delegate_address: '0xnew', block_number: '200' }),
      ],
      NOW,
    );
    expect(out).toEqual([
      {
        platform: 'snapshot',
        system: 'delegate_registry',
        scope: 'lido-snapshot.eth',
        network: '0x1',
        delegate_address: '0xnew',
        weight: null,
        expires_at: null,
      },
    ]);
  });

  it('drops a group whose latest event is a CLEAR', () => {
    const out = resolveActorCurrentDelegations(
      [
        row({ delegate_address: '0xbb', block_number: '100', event_type: 'set' }),
        row({ delegate_address: '0x0', block_number: '200', event_type: 'clear' }),
      ],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('keeps space-specific and global delegate_registry as separate entries', () => {
    const out = resolveActorCurrentDelegations(
      [
        row({ space_id: 'lido-snapshot.eth', delegate_address: '0xspace' }),
        row({ space_id: null, delegate_address: '0xglobal', block_number: '90' }),
      ],
      NOW,
    );
    expect(out.map((d) => [d.scope, d.delegate_address])).toEqual(
      expect.arrayContaining([
        ['lido-snapshot.eth', '0xspace'],
        [null, '0xglobal'],
      ]),
    );
  });

  it('excludes expired split delegations and surfaces weights', () => {
    const out = resolveActorCurrentDelegations(
      [
        // A split event emits its whole delegate set in one log, so they share (block, log_index).
        row({
          delegation_system: 'split_delegation',
          delegate_address: '0xactive',
          weight: '0.7',
          expires_at: new Date('2026-12-01T00:00:00Z'),
          block_number: '300',
          log_index: 0,
        }),
        row({
          delegation_system: 'split_delegation',
          delegate_address: '0xexpired',
          weight: '0.3',
          expires_at: new Date('2026-02-01T00:00:00Z'),
          block_number: '300',
          log_index: 0,
        }),
      ],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.delegate_address).toBe('0xactive');
    expect(out[0]?.weight).toBe('0.7');
    expect(out[0]?.system).toBe('split_delegation');
  });
});
