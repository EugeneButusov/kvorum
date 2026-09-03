import type {
  EligibleVpProvider,
  EligibleVpProposalContext,
  EligibleVpRpcSend,
} from '@sources/core';
import { decodeTotalSupplyResult, encodeTotalSupplyCall } from './abi/total-supply';

export const aaveV3EligibleVpProvider: EligibleVpProvider = {
  sourceTypes: ['aave_governance_v3'],

  async fetchEligibleVp(
    ctx: EligibleVpProposalContext,
    send: EligibleVpRpcSend,
  ): Promise<bigint | null> {
    if (ctx.votingStartsBlock == null) return null;

    const blockTag = `0x${BigInt(ctx.votingStartsBlock).toString(16)}`;
    const hex = await send<string>('eth_call', [
      { to: ctx.primaryTokenAddress, data: encodeTotalSupplyCall() },
      blockTag,
    ]);
    return decodeTotalSupplyResult(hex);
  },
};
