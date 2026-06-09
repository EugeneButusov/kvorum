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

  /**
   * Return the strategy's independent reference value for one address at the snapshot.
   *
   * For Compound this is an on-chain reread (`getPriorVotes`).
   * For Aave v3 this is the protocol-reported vote power already validated by submitted
   * storage proofs (`VoteEmitted.votingPower`), not a second token-contract reread.
   */
  verifyOnChain(address: string, block: bigint, ctx: VotingPowerStrategyContext): Promise<bigint>;
}
