import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { DualGovernanceEvent } from '../domain/types';

export interface DualGovernanceEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: DualGovernanceEvent['type'];
  payload: string;
}

export interface DualGovernanceEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
