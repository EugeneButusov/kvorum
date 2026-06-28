import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { EasyTrackEvent } from '../domain/types';

export interface EasyTrackEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: EasyTrackEvent['type'];
  payload: string;
}

export interface EasyTrackEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
