import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { AaveGovernorV2Event } from '../domain/types';

export interface AaveGovernorV2EventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: AaveGovernorV2Event['type'];
  payload: string;
}

export interface AaveGovernorV2EventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
