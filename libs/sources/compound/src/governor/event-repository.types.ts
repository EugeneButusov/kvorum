import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { CompoundGovernorEvent } from './types';

export interface EventData {
  daoSourceId: string;
  chainId: number;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: CompoundGovernorEvent['type'];
  payload: string;
}

export interface EventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
