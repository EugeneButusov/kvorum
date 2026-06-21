import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { AragonVotingEvent } from '../domain/types';

export interface AragonVotingEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: AragonVotingEvent['type'];
  payload: string;
}

export interface AragonVotingEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
