import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { AavePayloadsControllerEvent } from '../domain/types';

export interface AavePayloadsControllerEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: AavePayloadsControllerEvent['type'];
  payload: string;
}

export interface AavePayloadsControllerEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
