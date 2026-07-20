import { Injectable } from '@nestjs/common';
import {
  PROPOSAL_SUMMARY_TEMPLATE,
  render,
  type CostContext,
  type ProposalSummary,
  type RenderedPrompt,
} from '@libs/ai';
import { ProposalReadRepository } from '@libs/db';
import type { Proposal, ProposalAction } from '@libs/db';

export interface AssembledSummaryInput {
  rendered: RenderedPrompt<ProposalSummary>;
  ctx: CostContext;
}

/** Canonical JSON of the decoded actions — sorted by action_index and projected to the fields the
 *  summarizer needs, so the input hash is stable across row-order and column churn. */
export function serializeDecodedActions(actions: ProposalAction[]): string {
  const rows = actions
    .slice()
    .sort((a, b) => a.action_index - b.action_index)
    .map((a) => ({
      action_index: a.action_index,
      target_address: a.target_address,
      target_chain_id: a.target_chain_id,
      value_wei: a.value_wei,
      function_signature: a.function_signature,
      decoded_function: a.decoded_function,
      decoded_arguments: a.decoded_arguments,
    }));
  return JSON.stringify(rows);
}

@Injectable()
export class ProposalSummaryAssembler {
  constructor(private readonly proposals: ProposalReadRepository) {}

  async assemble(proposal: Proposal): Promise<AssembledSummaryInput> {
    const actions = await this.proposals.findActions(proposal.id);
    const rendered = render(PROPOSAL_SUMMARY_TEMPLATE, {
      description: proposal.description,
      decoded_actions: serializeDecodedActions(actions),
    });
    return {
      rendered,
      ctx: { daoId: proposal.dao_id, entityReference: `proposal:${proposal.id}` },
    };
  }
}
