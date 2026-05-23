export interface VotingPowerStrategyContext {
  daoId: string;
}

export interface ComputedActorPower {
  actorId: string;
  address: string;
  power: bigint;
}

export interface VotingPowerStrategy {
  computeSnapshot(block: bigint, ctx: VotingPowerStrategyContext): Promise<ComputedActorPower[]>;

  verifyOnChain(address: string, block: bigint, ctx: VotingPowerStrategyContext): Promise<bigint>;
}
