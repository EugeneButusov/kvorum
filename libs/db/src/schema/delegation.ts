import type { Generated, Insertable, Selectable } from 'kysely';

export type DelegationEventType = 'delegate_changed' | 'votes_changed';

export interface DelegationTable {
  id: Generated<string>;
  dao_id: string;
  delegator_actor_id: string;
  delegate_actor_id: string | null;
  voting_power: string;
  block_number: string;
  tx_index: Generated<number>;
  log_index: Generated<number>;
  tx_hash: string;
  event_type: DelegationEventType;
  created_at: Generated<Date>;
}

export type Delegation = Selectable<DelegationTable>;
export type NewDelegation = Insertable<DelegationTable>;
