import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { CompTokenEvent } from '../domain/types';

export interface CompTokenEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: CompTokenEvent['type'];
  payload: string;
}

export interface CompTokenEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
