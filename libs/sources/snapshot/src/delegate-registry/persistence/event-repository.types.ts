import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { DelegateRegistryEventType } from '../abi/events';

export interface DelegateRegistryEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}

export interface DelegateRegistryEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: DelegateRegistryEventType;
  payload: string;
}
