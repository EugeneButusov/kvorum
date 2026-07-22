import { Injectable } from '@nestjs/common';
import {
  PROPOSAL_SUMMARY_SIGNALING_TEMPLATE,
  PROPOSAL_SUMMARY_TEMPLATE,
  render,
  serializeDecodedActions,
  type CostContext,
  type ProposalSummary,
  type RenderedPrompt,
} from '@libs/ai';
import { ProposalReadRepository } from '@libs/db';
import type { Proposal } from '@libs/db';

export interface AssembledSummaryInput {
  rendered: RenderedPrompt<ProposalSummary>;
  ctx: CostContext;
}

@Injectable()
export class ProposalSummaryAssembler {
  constructor(private readonly proposals: ProposalReadRepository) {}

  async assemble(proposal: Proposal): Promise<AssembledSummaryInput> {
    const actions = await this.proposals.findActions(proposal.id);
    // Route by `binding`: on-chain binding proposals get the binding template; non-binding
    // (Snapshot signaling) get the signaling-tuned variant. Both share the proposal_summarizer
    // feature and the same inputContent/cache-key contract.
    const template = proposal.binding
      ? PROPOSAL_SUMMARY_TEMPLATE
      : PROPOSAL_SUMMARY_SIGNALING_TEMPLATE;
    const rendered = render(template, {
      description: proposal.description,
      decoded_actions: serializeDecodedActions(actions),
    });
    return {
      rendered,
      ctx: { daoId: proposal.dao_id, entityReference: `proposal:${proposal.id}` },
    };
  }
}
