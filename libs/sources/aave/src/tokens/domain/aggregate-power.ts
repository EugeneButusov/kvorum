import type { TokenPowerReads } from './types';
import { A_AAVE_TOKEN_ADDRESS, AAVE_TOKEN_ADDRESS, STK_AAVE_TOKEN_ADDRESS } from '../constants';

export function aggregateVotingPower(reads: TokenPowerReads): bigint {
  return reads.aave + reads.stkAave + reads.aAave;
}

export function aggregateSubmittedVotingPower(
  reads: TokenPowerReads,
  submittedAssets: string[],
): bigint {
  let total = 0n;

  for (const asset of submittedAssets) {
    switch (asset.toLowerCase()) {
      case AAVE_TOKEN_ADDRESS:
        total += reads.aave;
        break;
      case STK_AAVE_TOKEN_ADDRESS:
        total += reads.stkAave;
        break;
      case A_AAVE_TOKEN_ADDRESS:
        total += reads.aAave;
        break;
      default:
        throw new Error(`unsupported Aave voting asset: ${asset}`);
    }
  }

  return total;
}
