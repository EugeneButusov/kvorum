import type { RawSlotTokenPowers, TokenPowerReads } from './types';
import {
  A_AAVE_TOKEN_ADDRESS,
  AAVE_TOKEN_ADDRESS,
  POWER_SCALE_FACTOR,
  SLASHING_EXCHANGE_RATE_PRECISION,
  STK_AAVE_TOKEN_ADDRESS,
} from '../constants';

const AAVE_BALANCE_MASK = (1n << 104n) - 1n;
const A_AAVE_BALANCE_MASK = (1n << 120n) - 1n;

enum DelegationMode {
  NO_DELEGATION = 0,
  VOTING_DELEGATED = 1,
  PROPOSITION_DELEGATED = 2,
  FULL_POWER_DELEGATED = 3,
}

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

export function reconstructVotingPowerFromRawSlots(raw: RawSlotTokenPowers): bigint {
  return (
    reconstructAaveLikeVotingPower(raw.aaveBaseBalanceSlot) +
    reconstructStkAaveVotingPower(raw.stkAaveBaseBalanceSlot, raw.stkAaveSlashingExchangeRate) +
    reconstructAAaveVotingPower(raw.aAaveBaseBalanceSlot, raw.aAaveDelegatedStateSlot)
  );
}

function reconstructAaveLikeVotingPower(power: bigint): bigint {
  const delegatedVotingPower = ((power >> 176n) & ((1n << 72n) - 1n)) * POWER_SCALE_FACTOR;
  const delegationMode = Number((power >> 248n) & 0xffn);

  if (delegationMode === DelegationMode.VOTING_DELEGATED) {
    return delegatedVotingPower;
  }

  if (delegationMode === DelegationMode.FULL_POWER_DELEGATED) {
    return delegatedVotingPower;
  }

  return delegatedVotingPower + (power & AAVE_BALANCE_MASK);
}

function reconstructStkAaveVotingPower(power: bigint, slashingExchangeRate: bigint): bigint {
  if (slashingExchangeRate === 0n) {
    throw new Error('stkAave slashing exchange rate must be non-zero');
  }

  return (
    (reconstructAaveLikeVotingPower(power) * SLASHING_EXCHANGE_RATE_PRECISION) /
    slashingExchangeRate
  );
}

function reconstructAAaveVotingPower(baseBalanceSlot: bigint, delegatedStateSlot: bigint): bigint {
  const delegatedVotingPower =
    ((delegatedStateSlot >> 72n) & ((1n << 72n) - 1n)) * POWER_SCALE_FACTOR;
  const delegationMode = Number((baseBalanceSlot >> 120n) & 0xffn);

  if (delegationMode === DelegationMode.VOTING_DELEGATED) {
    return delegatedVotingPower;
  }

  if (delegationMode === DelegationMode.FULL_POWER_DELEGATED) {
    return delegatedVotingPower;
  }

  return delegatedVotingPower + (baseBalanceSlot & A_AAVE_BALANCE_MASK);
}
