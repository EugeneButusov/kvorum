import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { AaveVotingMachineEvent } from '../domain/types';

export interface AaveVotingMachineEventData {
  daoSourceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventType: AaveVotingMachineEvent['type'];
  payload: string;
}

export interface AaveVotingMachineEventRepositoryDeps {
  chDb: Kysely<ClickHouseDatabase>;
}
