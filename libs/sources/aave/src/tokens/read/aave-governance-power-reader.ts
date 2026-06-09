import { Interface } from 'ethers';
import type { ChainContextRegistry } from '@libs/chain';
import { GOVERNANCE_POWER_TOKEN_ABI } from '../abi/governance-power-token-abi';
import {
  A_AAVE_TOKEN_ADDRESS,
  AAVE_TOKEN_ADDRESS,
  AAVE_VOTING_POWER_CHAIN_ID,
  GOVERNANCE_POWER_TYPE_VOTING,
  STK_AAVE_TOKEN_ADDRESS,
} from '../constants';
import type { TokenPowerReads } from '../domain/types';

const iface = new Interface(GOVERNANCE_POWER_TOKEN_ABI);

export class AaveGovernancePowerReader {
  constructor(
    private readonly chainContextRegistry: ChainContextRegistry,
    private readonly chainId = AAVE_VOTING_POWER_CHAIN_ID,
  ) {}

  async read(address: string, block: bigint): Promise<TokenPowerReads> {
    const chainCtx = this.chainContextRegistry.peek(this.chainId);
    if (chainCtx === undefined) {
      throw new Error(`chain context missing for ${this.chainId}`);
    }

    const blockTag = `0x${block.toString(16)}`;
    const [aave, stkAave, aAave] = await Promise.all([
      this.readPower(chainCtx.client, AAVE_TOKEN_ADDRESS, address, blockTag),
      this.readPower(chainCtx.client, STK_AAVE_TOKEN_ADDRESS, address, blockTag),
      this.readPower(chainCtx.client, A_AAVE_TOKEN_ADDRESS, address, blockTag),
    ]);

    return { aave, stkAave, aAave };
  }

  private async readPower(
    client: { send<T>(method: string, params: unknown[]): Promise<T> },
    tokenAddress: string,
    address: string,
    blockTag: string,
  ): Promise<bigint> {
    const data = iface.encodeFunctionData('getPowerCurrent', [
      address,
      GOVERNANCE_POWER_TYPE_VOTING,
    ]);
    const result = await client.send<string>('eth_call', [{ to: tokenAddress, data }, blockTag]);
    const [power] = iface.decodeFunctionResult('getPowerCurrent', result);
    return power as bigint;
  }
}
