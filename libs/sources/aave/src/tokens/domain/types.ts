export interface TokenPowerReads {
  aave: bigint;
  stkAave: bigint;
  aAave: bigint;
}

export interface RawSlotTokenPowers {
  aaveBaseBalanceSlot: bigint;
  stkAaveBaseBalanceSlot: bigint;
  aAaveBaseBalanceSlot: bigint;
  aAaveDelegatedStateSlot: bigint;
  stkAaveSlashingExchangeRate: bigint;
}
