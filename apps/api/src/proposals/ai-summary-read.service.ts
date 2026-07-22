import { Injectable } from '@nestjs/common';
import {
  AiOutputRepository,
  PROPOSAL_SUMMARY_TEMPLATE,
  proposalSummaryInputHash,
  type AiOutput,
} from '@libs/ai';
import type { ProposalAction } from '@libs/db';

// Both summarizer templates store under one (feature, version); the lookup is content-addressed and
// template-agnostic. Derived from the template so an API lookup tracks the template's version.
const FEATURE = PROPOSAL_SUMMARY_TEMPLATE.feature ?? PROPOSAL_SUMMARY_TEMPLATE.name;
const VERSION = PROPOSAL_SUMMARY_TEMPLATE.version;

/**
 * Reads a proposal's stored AI summary. `ai_output` has no proposal FK — it is content-addressed by
 * `(feature, prompt_version, input_hash)` — so this recomputes the same `input_hash` the worker used
 * (SPEC §5.5 caching) and looks it up. Returns `null` when no summary exists (unprocessed,
 * budget-capped, or the description/actions changed since it was summarized → hash miss).
 */
@Injectable()
export class AiSummaryReadService {
  constructor(private readonly outputs: AiOutputRepository) {}

  async findForProposal(description: string, actions: ProposalAction[]): Promise<AiOutput | null> {
    const inputHash = proposalSummaryInputHash(description, actions);
    const row = await this.outputs.find(FEATURE, VERSION, inputHash);
    return row ?? null;
  }
}
