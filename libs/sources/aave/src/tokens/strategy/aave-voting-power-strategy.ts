import type { Logger } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import { ActorRepository, VoteEventsProjectionReadRepository } from '@libs/db';
import type {
  ComputedActorPower,
  VotingPowerStrategy,
  VotingPowerStrategyContext,
} from '@libs/domain';
import { aggregateVotingPower } from '../domain/aggregate-power';
import type { AaveGovernancePowerReader } from '../read/aave-governance-power-reader';

export class AaveVotingPowerStrategy implements VotingPowerStrategy {
  constructor(
    private readonly voteRead: VoteEventsProjectionReadRepository,
    private readonly actors: ActorRepository,
    private readonly reader: AaveGovernancePowerReader,
    private readonly logger: Logger = silentLogger,
  ) {}

  async computeSnapshot(
    block: bigint,
    ctx: VotingPowerStrategyContext,
  ): Promise<ComputedActorPower[]> {
    if (ctx.proposalId == null || ctx.proposalId.length === 0) {
      throw new Error('proposalId is required for aave voting-power snapshots');
    }

    const voters = await this.voteRead.listVotersForProposal({
      daoId: ctx.daoId,
      proposalId: ctx.proposalId,
    });
    if (voters.length === 0) return [];

    const actorMatches = await this.actors.findActorIdsByAddresses(
      voters.map((row) => row.voterAddress.toLowerCase()),
    );
    const actorIdByAddress = new Map(actorMatches.map((row) => [row.address, row.actor_id]));
    const primaryRows = await this.actors.findPrimaryAddressesByActorIds([
      ...new Set(actorMatches.map((row) => row.actor_id)),
    ]);
    const primaryByActorId = new Map(primaryRows.map((row) => [row.actor_id, row.address]));

    const computed = await Promise.all(
      voters.map(async (row) => {
        const votingAddress = row.voterAddress.toLowerCase();
        const actorId = actorIdByAddress.get(votingAddress);
        if (actorId === undefined) {
          this.logger.warn('aave_snapshot_actor_missing_for_voter', {
            voter_address: votingAddress,
          });
          return undefined;
        }

        const primaryAddress = primaryByActorId.get(actorId);
        if (primaryAddress === undefined) {
          this.logger.warn('aave_snapshot_actor_primary_address_missing', { actor_id: actorId });
          return undefined;
        }

        const reads = await this.reader.read(votingAddress, block);
        return {
          actorId,
          address: primaryAddress,
          votingAddress,
          power: aggregateVotingPower(reads),
        } satisfies ComputedActorPower;
      }),
    );

    return computed.flatMap((row) => (row === undefined ? [] : [row]));
  }

  async verifyOnChain(
    address: string,
    _block: bigint,
    ctx: VotingPowerStrategyContext,
  ): Promise<bigint> {
    if (ctx.proposalId == null || ctx.proposalId.length === 0) {
      throw new Error('proposalId is required for aave vote verification');
    }

    const vote = await this.voteRead.findCurrentVote({
      daoId: ctx.daoId,
      proposalId: ctx.proposalId,
      voterAddress: address.toLowerCase(),
    });
    if (vote === undefined) {
      throw new Error(`vote not found for dao_id=${ctx.daoId} proposal_id=${ctx.proposalId}`);
    }

    return BigInt(vote.votingPower);
  }
}
