import type {
  EligibleVpProvider,
  EligibleVpProposalContext,
  EligibleVpRpcSend,
} from '@sources/core';
import { decodeTotalSupplyResult, encodeTotalSupplyCall } from './abi/total-supply';

export const compoundEligibleVpProvider: EligibleVpProvider = {
  sourceTypes: ['compound_governor_bravo', 'compound_governor_alpha', 'compound_governor_oz'],

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
