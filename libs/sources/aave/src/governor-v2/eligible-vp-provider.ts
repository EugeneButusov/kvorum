import type {
  EligibleVpProvider,
  EligibleVpProposalContext,
  EligibleVpRpcSend,
} from '@sources/core';
import {
  decodeTotalVotingSupplyAtResult,
  encodeTotalVotingSupplyAtCall,
} from './abi/governance-strategy';

export const aaveV2EligibleVpProvider: EligibleVpProvider = {
  sourceTypes: ['aave_governor_v2'],

  async fetchEligibleVp(
    ctx: EligibleVpProposalContext,
    send: EligibleVpRpcSend,
  ): Promise<bigint | null> {
    if (ctx.votingStartsBlock == null || ctx.votingStrategyAddress == null) return null;

    const blockNumber = BigInt(ctx.votingStartsBlock);
    const blockTag = `0x${blockNumber.toString(16)}`;
    const hex = await send<string>('eth_call', [
      { to: ctx.votingStrategyAddress, data: encodeTotalVotingSupplyAtCall(blockNumber) },
      blockTag,
    ]);
    return decodeTotalVotingSupplyAtResult(hex);
  },
};
