import type { Insertable, Selectable } from 'kysely';

export interface SeenLogTable {
  chain_id: string;
  tx_hash: string;
  log_index: number;
  block_number: string; // pg bigint → string driver representation
  block_hash: string;
}

export type SeenLog = Selectable<SeenLogTable>;
export type NewSeenLog = Insertable<SeenLogTable>;
