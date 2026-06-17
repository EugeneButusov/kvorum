import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { AaveTokenEvent } from '../domain/types';

export interface AaveTokenEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: AaveTokenEvent['type'];
  payload: string;
}

export interface AaveTokenEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
