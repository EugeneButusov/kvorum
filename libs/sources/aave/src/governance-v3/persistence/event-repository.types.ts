import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { AaveGovernanceV3Event } from '../domain/types';

export interface AaveGovernanceEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: AaveGovernanceV3Event['type'];
  payload: string;
}

export interface AaveGovernanceEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
