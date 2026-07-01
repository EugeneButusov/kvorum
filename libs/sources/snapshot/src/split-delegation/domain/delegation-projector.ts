import type { ArchiveDerivationRow } from '@libs/db';
import { ZERO_DELEGATE_ADDRESS } from '@libs/db';
import type { SplitDelegationEntry, SplitDelegationEvent } from './types';
import { normalizeWeights } from './weights';
import { bytes32ToAddress } from '../../delegation/address';
import { DELEGATION_EVENT_TYPE, DELEGATION_SYSTEM } from '../../delegation/constants';
import type { NewSnapshotDelegation } from '../../persistence/schema';

export interface SplitDelegationProjectionContext {
  // Resolved snapshot dao for the context space; null if the space has no snapshot dao_source.
  daoId: string | null;
  network: string;
}

// Max Date the platform represents (±8.64e15 ms); guards an absurd on-chain expiration.
const MAX_EXPIRY_SECONDS = 8_640_000_000_000;

function expiresAt(timestamp: string): Date | null {
  const seconds = BigInt(timestamp);
  if (seconds === 0n) return null; // no expiry
  if (seconds > BigInt(MAX_EXPIRY_SECONDS)) return null;
  return new Date(Number(seconds) * 1000);
}

function baseRow(
  event: SplitDelegationEvent,
  row: ArchiveDerivationRow,
  ctx: SplitDelegationProjectionContext,
): Omit<NewSnapshotDelegation, 'delegate_address' | 'weight' | 'event_type' | 'expires_at'> {
  return {
    dao_id: ctx.daoId,
    delegator_address: account(event).toLowerCase(),
    space_id: event.payload.context,
    network: ctx.network,
    delegation_system: DELEGATION_SYSTEM.SPLIT_DELEGATION,
    block_number: row.block_number,
    log_index: row.log_index,
    tx_hash: row.tx_hash,
    created_at: row.received_at,
  };
}

function account(event: SplitDelegationEvent): string {
  return 'account' in event.payload ? event.payload.account : event.payload.delegate;
}

function clearRow(
  event: SplitDelegationEvent,
  row: ArchiveDerivationRow,
  ctx: SplitDelegationProjectionContext,
): NewSnapshotDelegation {
  return {
    ...baseRow(event, row, ctx),
    delegate_address: ZERO_DELEGATE_ADDRESS,
    weight: null,
    expires_at: null,
    event_type: DELEGATION_EVENT_TYPE.CLEAR,
  };
}

function setRows(
  event: SplitDelegationEvent,
  delegation: SplitDelegationEntry[],
  timestamp: string,
  row: ArchiveDerivationRow,
  ctx: SplitDelegationProjectionContext,
): NewSnapshotDelegation[] {
  // bytes32 delegates that are not EVM addresses (non-zero upper word) are cross-chain ids we
  // cannot represent as an address — skip them (the remaining EVM delegates still project).
  const resolved = delegation
    .map((d) => ({ address: bytes32ToAddress(d.delegate), ratio: BigInt(d.ratio) }))
    .filter((d): d is { address: string; ratio: bigint } => d.address !== null);

  if (resolved.length === 0) return [clearRow(event, row, ctx)];

  const weights = normalizeWeights(resolved.map((d) => d.ratio));
  const expiry = expiresAt(timestamp);
  const base = baseRow(event, row, ctx);
  return resolved.map((d, i) => ({
    ...base,
    delegate_address: d.address,
    weight: weights[i] as string,
    expires_at: expiry,
    event_type: DELEGATION_EVENT_TYPE.SET,
  }));
}

/**
 * One Split Delegation event → N `snapshot_delegation` rows.
 * - DelegationUpdated / ExpirationUpdated: the new (or expiry-refreshed) delegate set, weighted.
 * - DelegationCleared (or an empty delegation array): a single ZERO_DELEGATE_ADDRESS clear row.
 * - OptOutStatusSet: no projection (returned empty; the applier no-op derives it).
 */
export function projectSplitDelegationEvent(
  event: SplitDelegationEvent,
  row: ArchiveDerivationRow,
  ctx: SplitDelegationProjectionContext,
): NewSnapshotDelegation[] {
  switch (event.type) {
    case 'DelegationUpdated':
    case 'ExpirationUpdated':
      return setRows(event, event.payload.delegation, event.payload.expirationTimestamp, row, ctx);
    case 'DelegationCleared':
      return [clearRow(event, row, ctx)];
    case 'OptOutStatusSet':
      return [];
  }
}
