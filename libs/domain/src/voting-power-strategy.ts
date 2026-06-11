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
  /**
   * Compute the strategy's canonical snapshot population for a proposal/block pair.
   * The returned `power` is the strategy-owned computed value persisted in the snapshot
   * projection. `votingAddress` is optional and lets sources preserve the address the
   * computation was performed for when it differs from the actor's canonical address.
   */
  computeSnapshot(block: bigint, ctx: VotingPowerStrategyContext): Promise<ComputedActorPower[]>;
}
