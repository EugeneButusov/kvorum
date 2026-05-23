import { Interface } from 'ethers';
import { sql, type Kysely } from 'kysely';
import type { ChainContextRegistry, Logger } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { PgDatabase } from '@libs/db';
import type {
  ComputedActorPower,
  VotingPowerStrategy,
  VotingPowerStrategyContext,
} from '@libs/domain';
import { COMP_TOKEN_VOTING_POWER_ABI } from './comp-token-abi';

const iface = new Interface(COMP_TOKEN_VOTING_POWER_ABI);

interface DelegationRow {
  event_type: 'delegate_changed' | 'votes_changed';
  delegator_actor_id: string;
  delegate_actor_id: string | null;
  voting_power: string;
}

export class CompoundCompTokenVotingPowerStrategy implements VotingPowerStrategy {
  private readonly tokenAddressByDaoId = new Map<string, string>();

  constructor(
    private readonly pgDb: Kysely<PgDatabase>,
    private readonly chainContextRegistry: ChainContextRegistry,
    private readonly chainId: string,
    private readonly logger: Logger = silentLogger,
  ) {}

  async computeSnapshot(
    block: bigint,
    ctx: VotingPowerStrategyContext,
  ): Promise<ComputedActorPower[]> {
    const rows = (await this.pgDb
      .selectFrom('delegation')
      .select(['event_type', 'delegator_actor_id', 'delegate_actor_id', 'voting_power'])
      .where('dao_id', '=', ctx.daoId)
      .where('block_number', '<=', block.toString())
      .orderBy('block_number', 'asc')
      .orderBy('tx_index', 'asc')
      .orderBy('log_index', 'asc')
      .execute()) as DelegationRow[];

    const powerByActorId = new Map<string, bigint>();
    const population = new Set<string>();

    for (const row of rows) {
      population.add(row.delegator_actor_id);
      if (row.delegate_actor_id !== null) population.add(row.delegate_actor_id);
      if (row.event_type === 'votes_changed' && row.delegate_actor_id !== null) {
        powerByActorId.set(row.delegate_actor_id, BigInt(row.voting_power));
      }
    }

    if (population.size === 0) return [];

    const addresses = await this.pgDb
      .selectFrom('actor_address')
      .select(['actor_id', 'address'])
      .where('actor_id', 'in', [...population])
      .where('is_primary', '=', true)
      .execute();

    const addressByActorId = new Map(addresses.map((row) => [row.actor_id, row.address]));

    const output: ComputedActorPower[] = [];
    for (const actorId of population) {
      const address = addressByActorId.get(actorId);
      if (address === undefined) {
        this.logger.warn('snapshot_actor_primary_address_missing', { actor_id: actorId });
        continue;
      }
      output.push({
        actorId,
        address,
        power: powerByActorId.get(actorId) ?? 0n,
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

    const row = await this.pgDb
      .selectFrom('dao_source')
      .select(sql<string>`source_config ->> 'token_address'`.as('token_address'))
      .where('dao_id', '=', daoId)
      .where('source_type', '=', 'compound_comp_token')
      .executeTakeFirst();

    if (row?.token_address == null || row.token_address.length === 0) {
      throw new Error(`compound_comp_token token address missing for dao_id=${daoId}`);
    }

    const address = row.token_address.toLowerCase();
    this.tokenAddressByDaoId.set(daoId, address);
    return address;
  }
}
