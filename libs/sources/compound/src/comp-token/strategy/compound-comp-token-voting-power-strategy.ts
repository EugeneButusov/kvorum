import { Interface } from 'ethers';
import type { ChainContextRegistry, Logger } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import { ActorRepository, DaoSourceRepository } from '@libs/db';
import type {
  ComputedActorPower,
  VotingPowerStrategy,
  VotingPowerStrategyContext,
} from '@libs/domain';
import { COMP_TOKEN_VOTING_POWER_ABI } from './comp-token-abi';
import type { CompTokenDelegationSnapshotRepository } from '../persistence/delegation-snapshot-repository';

const iface = new Interface(COMP_TOKEN_VOTING_POWER_ABI);

export class CompoundCompTokenVotingPowerStrategy implements VotingPowerStrategy {
  private readonly tokenAddressByDaoId = new Map<string, string>();

  constructor(
    private readonly delegations: CompTokenDelegationSnapshotRepository,
    private readonly actors: ActorRepository,
    private readonly daoSources: DaoSourceRepository,
    private readonly chainContextRegistry: ChainContextRegistry,
    private readonly chainId: string,
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

  async verifyOnChain(
    address: string,
    block: bigint,
    ctx: VotingPowerStrategyContext,
  ): Promise<bigint> {
    const tokenAddress = await this.resolveCompTokenAddress(ctx.daoId);
    const chainCtx = this.chainContextRegistry.peek(this.chainId);
    if (chainCtx === undefined) {
      throw new Error(`chain context missing for ${this.chainId}`);
    }

    const data = iface.encodeFunctionData('getPriorVotes', [address, block]);
    const result = await chainCtx.client.send<string>('eth_call', [
      { to: tokenAddress, data },
      `0x${block.toString(16)}`,
    ]);

    const [votes] = iface.decodeFunctionResult('getPriorVotes', result);
    return votes as bigint;
  }

  private async resolveCompTokenAddress(daoId: string): Promise<string> {
    const cached = this.tokenAddressByDaoId.get(daoId);
    if (cached !== undefined) return cached;

    const tokenAddress = await this.daoSources.findTokenAddressByDaoAndSourceType(
      daoId,
      'compound_comp_token',
    );

    if (tokenAddress == null || tokenAddress.length === 0) {
      throw new Error(`compound_comp_token token address missing for dao_id=${daoId}`);
    }

    const address = tokenAddress.toLowerCase();
    this.tokenAddressByDaoId.set(daoId, address);
    return address;
  }
}

const ZERO_DELEGATE_ADDRESS = '0x0000000000000000000000000000000000000000';
