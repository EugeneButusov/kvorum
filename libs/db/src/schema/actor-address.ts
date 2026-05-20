import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface ActorAddressSourceTable {
  name: string;
}

export type ActorAddressSource = Selectable<ActorAddressSourceTable>;
export type NewActorAddressSource = Insertable<ActorAddressSourceTable>;

export interface ActorAddressTable {
  actor_id: string;
  address: string;
  is_primary: boolean;
  source: string;
  created_at: Generated<Date>;
}

export type ActorAddress = Selectable<ActorAddressTable>;
export type NewActorAddress = Insertable<ActorAddressTable>;
export type ActorAddressUpdate = Updateable<ActorAddressTable>;

export interface ActorAddressRedirectTable {
  from_address: string;
  to_actor_id: string;
  merged_at: Date;
  merge_reason: string;
  created_by: string;
}

export type ActorAddressRedirect = Selectable<ActorAddressRedirectTable>;
export type NewActorAddressRedirect = Insertable<ActorAddressRedirectTable>;
export type ActorAddressRedirectUpdate = Updateable<ActorAddressRedirectTable>;
