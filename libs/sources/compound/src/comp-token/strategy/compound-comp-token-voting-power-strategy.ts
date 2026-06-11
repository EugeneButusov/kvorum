import type { Logger } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import { ActorRepository } from '@libs/db';
import type {
  ComputedActorPower,
  VotingPowerStrategy,
  VotingPowerStrategyContext,
} from '@libs/domain';
import type { CompTokenDelegationSnapshotRepository } from '../persistence/delegation-snapshot-repository';

export class CompoundCompTokenVotingPowerStrategy implements VotingPowerStrategy {
  constructor(
    private readonly delegations: CompTokenDelegationSnapshotRepository,
    private readonly actors: ActorRepository,
    private readonly logger: Logger = silentLogger,
  ) {}

  async computeSnapshot(
    block: bigint,
    ctx: VotingPowerStrategyContext,
  ): Promise<ComputedActorPower[]> {
    const rows = await this.delegations.listForSnapshot(ctx.daoId, block.toString());

    const powerByActorId = new Map<string, bigint>();
    const populationByAddress = new Set<string>();

    for (const row of rows) {
      populationByAddress.add(row.delegator_address.toLowerCase());
      if (row.delegate_address !== ZERO_DELEGATE_ADDRESS) {
        populationByAddress.add(row.delegate_address.toLowerCase());
      }
      if (row.event_type === 'votes_changed' && row.delegate_address !== ZERO_DELEGATE_ADDRESS) {
        powerByActorId.set(row.delegate_address.toLowerCase(), BigInt(row.voting_power));
      }
    }

    if (populationByAddress.size === 0) return [];

    const actors = await this.actors.findActorsByAddresses([...populationByAddress]);
    const actorIds = new Set(actors.map((actor) => actor.id));
    const addresses = await this.actors.findPrimaryAddressesByActorIds([...actorIds]);

    const addressByActorId = new Map(addresses.map((record) => [record.actor_id, record.address]));

    const output: ComputedActorPower[] = [];
    for (const actorId of actorIds) {
      const address = addressByActorId.get(actorId);
      if (address === undefined) {
        this.logger.warn('snapshot_actor_primary_address_missing', { actor_id: actorId });
        continue;
      }
      output.push({
        actorId,
        address,
        power: powerByActorId.get(address.toLowerCase()) ?? 0n,
      });
    }

    return output;
  }
}

const ZERO_DELEGATE_ADDRESS = '0x0000000000000000000000000000000000000000';
