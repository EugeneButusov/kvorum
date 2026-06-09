export interface VotingPowerStrategyContext {
  daoId: string;
  proposalId?: string;
}

export interface ComputedActorPower {
  actorId: string;
  address: string;
  votingAddress?: string;
  power: bigint;
}

export interface VotingPowerStrategy {
  computeSnapshot(block: bigint, ctx: VotingPowerStrategyContext): Promise<ComputedActorPower[]>;

  verifyOnChain(address: string, block: bigint, ctx: VotingPowerStrategyContext): Promise<bigint>;
}
