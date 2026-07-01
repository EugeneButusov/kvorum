import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import { ZERO_DELEGATE_ADDRESS } from '@libs/db';
import { DELEGATION_EVENT_TYPE, DELEGATION_SYSTEM } from './constants';
import type { NewSnapshotDelegation, SnapshotDelegation } from '../persistence/schema';

export interface CurrentDelegate {
  delegate_address: string;
  weight: string | null;
  expires_at: Date | null;
}

export class SnapshotDelegationRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** Idempotent append. The unique key (network, tx_hash, log_index, delegate_address) makes a
   *  re-derived batch a no-op; clears carry ZERO_DELEGATE_ADDRESS so the key always fires. */
  async insertBatch(rows: readonly NewSnapshotDelegation[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insertInto('snapshot_delegation')
      .values(rows as NewSnapshotDelegation[])
      .onConflict((oc) =>
        oc.columns(['network', 'tx_hash', 'log_index', 'delegate_address']).doNothing(),
      )
      .execute();
  }

  /**
   * Current Delegate Registry delegate for a delegator in a space, applying
   * space-over-global precedence: a non-cleared space-specific delegation wins; otherwise fall
   * back to a non-cleared global (space_id IS NULL) delegation; otherwise none. Single delegate.
   */
  async findCurrentDelegateRegistryDelegation(
    delegatorAddress: string,
    space: string,
    network: string,
  ): Promise<CurrentDelegate | null> {
    const rows = await this.db
      .selectFrom('snapshot_delegation')
      .selectAll()
      .where('delegator_address', '=', delegatorAddress.toLowerCase())
      .where('network', '=', network)
      .where('delegation_system', '=', DELEGATION_SYSTEM.DELEGATE_REGISTRY)
      .where((eb) => eb.or([eb('space_id', '=', space), eb('space_id', 'is', null)]))
      .execute();

    return resolveCurrentDelegateRegistry(rows, space);
  }

  /**
   * Current Split Delegation delegate set for a delegator in a space: the delegates from the
   * latest non-cleared event coordinate, excluding any whose expiry has passed at `asOf`.
   */
  async findCurrentSplitDelegation(
    delegatorAddress: string,
    space: string,
    network: string,
    asOf: Date,
  ): Promise<CurrentDelegate[]> {
    const rows = await this.db
      .selectFrom('snapshot_delegation')
      .selectAll()
      .where('delegator_address', '=', delegatorAddress.toLowerCase())
      .where('network', '=', network)
      .where('space_id', '=', space)
      .where('delegation_system', '=', DELEGATION_SYSTEM.SPLIT_DELEGATION)
      .execute();

    return resolveCurrentSplit(rows, asOf);
  }
}

/** Pure Delegate Registry precedence resolution: space-specific (non-cleared) wins over global (non-cleared). */
export function resolveCurrentDelegateRegistry(
  rows: readonly SnapshotDelegation[],
  space: string,
): CurrentDelegate | null {
  const spaceLatest = latestEvent(rows.filter((r) => r.space_id === space));
  if (spaceLatest && spaceLatest.event_type === DELEGATION_EVENT_TYPE.SET) {
    return toCurrent(spaceLatest);
  }
  // No active space-specific delegation (absent or cleared) → fall back to global.
  const globalLatest = latestEvent(rows.filter((r) => r.space_id === null));
  if (globalLatest && globalLatest.event_type === DELEGATION_EVENT_TYPE.SET) {
    return toCurrent(globalLatest);
  }
  return null;
}

/** Pure Split Delegation resolution: the delegate set at the latest non-cleared coordinate, minus expired. */
export function resolveCurrentSplit(
  rows: readonly SnapshotDelegation[],
  asOf: Date,
): CurrentDelegate[] {
  if (rows.length === 0) return [];
  const maxCoord = maxCoordinate(rows);
  const atLatest = rows.filter((r) => coordKey(r) === maxCoord);
  if (atLatest.every((r) => r.event_type === DELEGATION_EVENT_TYPE.CLEAR)) return [];
  return atLatest
    .filter((r) => r.delegate_address !== ZERO_DELEGATE_ADDRESS)
    .filter((r) => r.expires_at === null || r.expires_at.getTime() > asOf.getTime())
    .map(toCurrent);
}

function coordKey(row: Pick<SnapshotDelegation, 'block_number' | 'log_index'>): string {
  // Zero-pad block_number for lexicographic ordering equivalent to numeric.
  return `${row.block_number.padStart(20, '0')}:${String(row.log_index).padStart(10, '0')}`;
}

function maxCoordinate(rows: readonly SnapshotDelegation[]): string {
  return rows.map(coordKey).reduce((a, b) => (a >= b ? a : b));
}

function latestEvent(rows: readonly SnapshotDelegation[]): SnapshotDelegation | null {
  if (rows.length === 0) return null;
  const max = maxCoordinate(rows);
  // A single coordinate has one Delegate Registry row (single delegate per SetDelegate/ClearDelegate log).
  return rows.find((r) => coordKey(r) === max) ?? null;
}

function toCurrent(row: SnapshotDelegation): CurrentDelegate {
  return {
    delegate_address: row.delegate_address,
    weight: row.weight,
    expires_at: row.expires_at,
  };
}
