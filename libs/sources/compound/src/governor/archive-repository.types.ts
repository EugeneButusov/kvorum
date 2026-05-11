import type { Kysely } from 'kysely';
import type { ClickHouseDatabase, PgDatabase } from '@libs/db';
import type { CompoundGovernorEvent } from './types';

export interface ArchiveKey {
  sourceType: 'compound_governor';
  chainId: number;
  txHash: string;
  logIndex: number;
  blockHash: string;
}

export interface ChEventData {
  daoSourceId: string;
  chainId: number;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: CompoundGovernorEvent['type'];
  payload: string;
}

export interface ArchiveRepositoryDeps {
  pgDb: Kysely<PgDatabase>;
  chDb: Kysely<ClickHouseDatabase>;
}
