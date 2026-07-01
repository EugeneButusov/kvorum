import type { ArchiveDerivationRow } from '@libs/db';
import { ZERO_DELEGATE_ADDRESS } from '@libs/db';
import type { DelegateRegistryEvent } from './types';
import { DELEGATION_EVENT_TYPE, DELEGATION_SYSTEM } from '../../delegation/constants';
import type { NewSnapshotDelegation } from '../../persistence/schema';

export interface DelegateRegistryProjectionContext {
  // null for global (id == 0x0); else the resolved snapshot dao for the space.
  daoId: string | null;
  // null for global; else the decoded space name.
  spaceId: string | null;
  network: string;
}

/**
 * One Delegate Registry event → one `snapshot_delegation` row. A SetDelegate stores the delegate;
 * a ClearDelegate stores ZERO_DELEGATE_ADDRESS (a non-null sentinel the unique key needs, and the
 * "no delegation" marker the precedence read recognizes).
 */
export function projectDelegateRegistryEvent(
  event: DelegateRegistryEvent,
  row: ArchiveDerivationRow,
  ctx: DelegateRegistryProjectionContext,
): NewSnapshotDelegation {
  const isSet = event.type === 'SetDelegate';
  return {
    dao_id: ctx.daoId,
    delegator_address: event.payload.delegator.toLowerCase(),
    delegate_address: isSet ? event.payload.delegate.toLowerCase() : ZERO_DELEGATE_ADDRESS,
    space_id: ctx.spaceId,
    network: ctx.network,
    delegation_system: DELEGATION_SYSTEM.DELEGATE_REGISTRY,
    weight: null,
    expires_at: null,
    event_type: isSet ? DELEGATION_EVENT_TYPE.SET : DELEGATION_EVENT_TYPE.CLEAR,
    block_number: row.block_number,
    log_index: row.log_index,
    tx_hash: row.tx_hash,
    created_at: row.received_at,
  };
}
