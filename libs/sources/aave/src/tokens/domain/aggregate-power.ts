import type { TokenPowerReads } from './types';

export function aggregateVotingPower(reads: TokenPowerReads): bigint {
  return reads.aave + reads.stkAave + reads.aAave;
}
