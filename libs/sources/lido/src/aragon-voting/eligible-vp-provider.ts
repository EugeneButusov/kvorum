import type {
  EligibleVpProvider,
  EligibleVpProposalContext,
  EligibleVpRpcSend,
} from '@sources/core';
import { decodeGetVote, encodeGetVote } from './abi/get-vote';

export const aragonEligibleVpProvider: EligibleVpProvider = {
  sourceTypes: ['aragon_voting'],

  async fetchEligibleVp(
    ctx: EligibleVpProposalContext,
    send: EligibleVpRpcSend,
  ): Promise<bigint | null> {
    if (ctx.votingAddress == null) return null;

    const hex = await send<string>('eth_call', [
      { to: ctx.votingAddress, data: encodeGetVote(ctx.sourceId) },
      'latest',
    ]);
    const vote = decodeGetVote(hex);
    return vote.votingPower;
  },
};
