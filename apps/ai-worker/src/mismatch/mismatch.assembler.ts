import { Injectable } from '@nestjs/common';
import {
  MISMATCH_DETECTOR_TEMPLATE,
  render,
  serializeDecodedActions,
  type CostContext,
  type MismatchAnalysis,
  type RenderedPrompt,
} from '@libs/ai';
import { ProposalReadRepository } from '@libs/db';
import type { Proposal } from '@libs/db';

export interface AssembledMismatchInput {
  rendered: RenderedPrompt<MismatchAnalysis>;
  ctx: CostContext;
}

/**
 * Builds the mismatch-detector LLM input (SPEC §5.6): the proposal `description` + the decoded
 * `proposal_action` rows. Contract-metadata enrichment (token symbols, role names) is out of scope
 * for v1 — that data isn't sourceable — and is a #440 prompt-engineering concern. The cache key is
 * `(mismatch_detector, v1.0, sha256(description + decoded_actions))` via `render`'s inputContent.
 */
@Injectable()
export class MismatchAssembler {
  constructor(private readonly proposals: ProposalReadRepository) {}

  async assemble(proposal: Proposal): Promise<AssembledMismatchInput> {
    const actions = await this.proposals.findActions(proposal.id);
    const rendered = render(MISMATCH_DETECTOR_TEMPLATE, {
      description: proposal.description,
      decoded_actions: serializeDecodedActions(actions),
    });
    return {
      rendered,
      ctx: { daoId: proposal.dao_id, entityReference: `proposal:${proposal.id}` },
    };
  }
}
