import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { SplitDelegationEventType } from '../abi/events';

export interface SplitDelegationEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}

export interface SplitDelegationEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: SplitDelegationEventType;
  payload: string;
}
