import { describe, expect, it } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { ZERO_DELEGATE_ADDRESS } from '@libs/db';
import { projectDelegateRegistryEvent } from './delegation-projector';
import type { DelegateRegistryEvent } from './types';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'snapshot_delegate_registry',
  dao_source_id: 'src-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 2,
  event_type: 'SetDelegate',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const DELEGATOR = `0x${'11'.repeat(20)}`;
const DELEGATE = `0x${'22'.repeat(20)}`;

describe('projectDelegateRegistryEvent', () => {
  it('projects a SetDelegate into a "set" row with the delegate and resolved dao/space', () => {
    const event: DelegateRegistryEvent = {
      type: 'SetDelegate',
      payload: { delegator: DELEGATOR, id: '0xspace', delegate: DELEGATE },
    };
    const row = projectDelegateRegistryEvent(event, ROW, {
      daoId: 'dao-1',
      spaceId: 'lido-snapshot.eth',
      network: '0x1',
    });
    expect(row).toMatchObject({
      dao_id: 'dao-1',
      delegator_address: DELEGATOR,
      delegate_address: DELEGATE,
      space_id: 'lido-snapshot.eth',
      network: '0x1',
      delegation_system: 'delegate_registry',
      weight: null,
      expires_at: null,
      event_type: 'set',
      block_number: '100',
      log_index: 2,
      tx_hash: '0xtx',
    });
  });

  it('projects a ClearDelegate into a "clear" row with the zero sentinel and null dao (global)', () => {
    const event: DelegateRegistryEvent = {
      type: 'ClearDelegate',
      payload: { delegator: DELEGATOR, id: '0x00', delegate: DELEGATE },
    };
    const row = projectDelegateRegistryEvent({ ...event }, ROW, {
      daoId: null,
      spaceId: null,
      network: '0x1',
    });
    expect(row.event_type).toBe('clear');
    expect(row.delegate_address).toBe(ZERO_DELEGATE_ADDRESS);
    expect(row.dao_id).toBeNull();
    expect(row.space_id).toBeNull();
  });
});
