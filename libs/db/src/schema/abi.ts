import type { Insertable, Selectable } from 'kysely';

export interface AbiCacheTable {
  chain_id: string;
  address: string;
  abi: unknown;
  source: string;
  fetched_at: Date;
  // Ordered array of proxy hop addresses terminating in the implementation.
  // null means this row is the final implementation.
  implementation_chain: unknown | null;
}

export type AbiCache = Selectable<AbiCacheTable>;
export type NewAbiCache = Insertable<AbiCacheTable>;

export interface SelectorIndexTable {
  selector: string;
  signature: string;
  source: string;
  imported_at: Date;
}

export type SelectorIndex = Selectable<SelectorIndexTable>;
export type NewSelectorIndex = Insertable<SelectorIndexTable>;
