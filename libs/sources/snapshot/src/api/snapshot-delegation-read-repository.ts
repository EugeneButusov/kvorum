import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { OffchainDelegationView } from '@libs/domain';
import { DELEGATION_EVENT_TYPE, DELEGATION_SYSTEM } from '../delegation/constants';
import {
  type CurrentDelegate,
  resolveCurrentSplit,
} from '../delegation/snapshot-delegation-repository';
import type { SnapshotDelegation } from '../persistence/schema';
import '../persistence/schema';

// Reads an actor's current Snapshot delegations (Delegate Registry single + Split Delegation
// weighted) into the medium-neutral OffchainDelegationView, for the per-actor delegation surface.
// Groups by (delegator, space, system) and resolves the active set per group; Split reuses the
// projection resolver. Global (dao_id null) Delegate Registry delegations apply to every space.
export class SnapshotDelegationReadRepository {
  constructor(
    private readonly db: Kysely<PgDatabase>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findCurrentForActor(
    daoId: string,
    delegatorAddresses: readonly string[],
  ): Promise<OffchainDelegationView[]> {
    if (delegatorAddresses.length === 0) return [];
    const lowered = delegatorAddresses.map((a) => a.toLowerCase());
    const rows = await this.db
      .selectFrom('snapshot_delegation')
      .selectAll()
      .where('delegator_address', 'in', lowered)
      .where((eb) =>
        eb.or([
          eb('dao_id', '=', daoId),
          eb.and([
            eb('dao_id', 'is', null),
            eb('delegation_system', '=', DELEGATION_SYSTEM.DELEGATE_REGISTRY),
          ]),
        ]),
      )
      .execute();

    return resolveActorCurrentDelegations(rows, this.now());
  }
}

// Pure: group by (delegator, space, system) and resolve the current active delegate set per group.
export function resolveActorCurrentDelegations(
  rows: readonly SnapshotDelegation[],
  asOf: Date,
): OffchainDelegationView[] {
  const groups = new Map<string, SnapshotDelegation[]>();
  for (const r of rows) {
    const key = `${r.delegator_address}|${r.space_id ?? ''}|${r.delegation_system}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [r]);
    else group.push(r);
  }

  const out: OffchainDelegationView[] = [];
  for (const group of groups.values()) {
    const sample = group[0];
    if (sample === undefined) continue;
    if (sample.delegation_system === DELEGATION_SYSTEM.SPLIT_DELEGATION) {
      for (const cur of resolveCurrentSplit(group, asOf)) out.push(toView(sample, cur));
    } else {
      const latest = latestByCoordinate(group);
      if (latest !== undefined && latest.event_type === DELEGATION_EVENT_TYPE.SET) {
        out.push(
          toView(latest, {
            delegate_address: latest.delegate_address,
            weight: latest.weight,
            expires_at: latest.expires_at,
          }),
        );
      }
    }
  }
  return out;
}

function latestByCoordinate(rows: readonly SnapshotDelegation[]): SnapshotDelegation | undefined {
  return rows.reduce<SnapshotDelegation | undefined>(
    (best, r) => (best === undefined || coordKey(r) > coordKey(best) ? r : best),
    undefined,
  );
}

function coordKey(row: SnapshotDelegation): string {
  return `${row.block_number.padStart(20, '0')}:${String(row.log_index).padStart(10, '0')}`;
}

function toView(row: SnapshotDelegation, cur: CurrentDelegate): OffchainDelegationView {
  return {
    platform: 'snapshot',
    system: row.delegation_system,
    scope: row.space_id,
    network: row.network,
    delegate_address: cur.delegate_address,
    weight: cur.weight,
    expires_at: cur.expires_at === null ? null : toIsoSeconds(cur.expires_at),
  };
}

function toIsoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
